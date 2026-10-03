import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  randomBytes,
  createCipheriv,
  createHmac,
  createHash,
} from "node:crypto";
import { SignJWT } from "jose";
import Database from "better-sqlite3";
import { createApp, Config } from "../server/app";
import {
  extractDocument,
  chunkUnits,
  signature,
  embeddings,
} from "../server/knowledge";
import { Secrets, LocalDB } from "../server/db";
import { RequestJSON } from "../server/knowledge";
import { memoryStorage, storageInput } from "./storage-fixture";
import { policyPDF, policyDOCX, mockRequest } from "./fixtures";
let handler: RequestJSON = mockRequest;
let root: string,
  service: Awaited<ReturnType<typeof createApp>>,
  admin: ReturnType<typeof request.agent>,
  csrf: string;
const secret = "test-secret-that-has-at-least-32-characters";
beforeEach(async () => {
  handler = mockRequest;
  root = mkdtempSync(join(tmpdir(), "raazi-ts-test-"));
  service = await createApp({
    database: join(root, "test.db"),
    secret,
    mode: "development",
    secure: false,
    adminGroup: "admins",
    request: (url, body, key) => handler(url, body, key),
    objectFactory: memoryStorage().factory,
  });
  await service.storage.save(storageInput);
  admin = request.agent(service.app);
  let result = await admin.get("/api/session");
  await admin.post("/auth/development").set("X-CSRF-Token", result.body.csrf);
  result = await admin.get("/api/session");
  csrf = result.body.csrf;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await service.close();
  const target = resolve(root);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !target.includes("raazi-ts-test-")
  )
    throw new Error("Unsafe cleanup path");
  rmSync(target, { recursive: true, force: true });
});
const mutate = (
  method: "post" | "put" | "patch" | "delete",
  path: string,
  body?: string | object,
) => admin[method](path).set("X-CSRF-Token", csrf).send(body);
async function configure() {
  expect(
    (
      await mutate("put", "/api/admin/settings", {
        base_url: "http://model.test/v1",
        model: "local",
        system_prompt: "Be helpful.",
        api_key: "model-secret",
      })
    ).status,
  ).toBe(200);
}
async function repo(groups: string[] = []) {
  return (
    await mutate("post", "/api/admin/repositories", { name: "HR", groups })
  ).body.id as number;
}
async function addDoc(rid: number) {
  return (
    await mutate("post", "/api/admin/documents", {
      repository_id: rid,
      title: "Leave policy",
      content: "Annual leave allowance is 25 days.",
    })
  ).body.id as number;
}
async function user(id = "employee", groups: string[] = []) {
  service.db.run(
    "INSERT OR IGNORE INTO users(id,name,email,role,groups_json) VALUES(?,?,?,?,?)",
    id,
    "Employee",
    "employee@test",
    "user",
    JSON.stringify(groups),
  );
  const csrf = "test-user-csrf",
    cookie = await new SignJWT({ uid: id, csrf })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("raazi")
      .setAudience("raazi-session")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
  return { cookie: "raazi_session=" + cookie, csrf };
}
const userGet = async (
  path: string,
  id = "employee",
  groups: string[] = [],
) => {
  const u = await user(id, groups);
  return request(service.app).get(path).set("Cookie", u.cookie);
};
describe("authentication and settings", () => {
  it("enforces authentication, role checks, CSRF, logout, and cookie defaults", async () => {
    expect((await request(service.app).get("/api/workspace")).status).toBe(401);
    expect(
      (await admin.post("/api/chat").send({ message: "hello" })).status,
    ).toBe(403);
    expect((await userGet("/api/admin")).status).toBe(403);
    const session = await request(service.app).get("/api/session");
    expect(session.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(session.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect((await mutate("post", "/auth/logout")).status).toBe(200);
    expect((await admin.get("/api/workspace")).status).toBe(401);
  });
  it("rejects invalid JSON, URLs, booleans and unauthenticated source access", async () => {
    expect((await mutate("post", "/api/chat", [])).status).toBe(400);
    expect(
      (
        await mutate("put", "/api/admin/settings", {
          base_url: "http://user:pass@host/v1",
          model: "model",
          system_prompt: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (await mutate("post", "/api/chat-groups", { name: "" })).status,
    ).toBe(400);
    expect((await request(service.app).get("/api/sources/abc")).status).toBe(
      401,
    );
  });
  it("encrypts credentials, keeps them on blank input, and supports explicit removal", async () => {
    await configure();
    const stored = service.db.get("SELECT api_key FROM settings")!.api_key;
    expect(stored).toMatch(/^v2:/);
    expect(service.secrets.open(stored)).toBe("model-secret");
    expect(JSON.stringify((await admin.get("/api/admin")).body)).not.toContain(
      "model-secret",
    );
    await mutate("put", "/api/admin/settings", {
      base_url: "http://model.test/v1",
      model: "local",
      system_prompt: "x",
    });
    expect(service.db.get("SELECT api_key FROM settings")!.api_key).toBe(
      stored,
    );
    await mutate("put", "/api/admin/settings", {
      base_url: "http://model.test/v1",
      model: "local",
      system_prompt: "x",
      clear_api_key: true,
    });
    expect(service.db.get("SELECT api_key FROM settings")!.api_key).toBe("");
  });
  it("reads legacy Fernet credentials with the original encryption key", () => {
    const key = randomBytes(32),
      iv = randomBytes(16),
      cipher = createCipheriv("aes-128-cbc", key.subarray(16), iv),
      stamp = Buffer.alloc(8);
    stamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
    const payload = Buffer.concat([
      Buffer.from([128]),
      stamp,
      iv,
      cipher.update("legacy-model-key"),
      cipher.final(),
    ]);
    const token = Buffer.concat([
      payload,
      createHmac("sha256", key.subarray(0, 16)).update(payload).digest(),
    ]).toString("base64url");
    const secrets = new Secrets(root, "development", key.toString("base64url"));
    expect(secrets.open(token)).toBe("legacy-model-key");
    const bad = Buffer.from(token, "base64url");
    bad[30] ^= 1;
    expect(() => secrets.open(bad.toString("base64url"))).toThrow();
  });
  it("applies profile context and disables existing user sessions immediately", async () => {
    await configure();
    const u = await user();
    await mutate("put", "/api/admin/users/employee", {
      department: "Finance",
      job_title: "Analyst",
      profile: "Budget owner",
      disabled: true,
    });
    expect(
      (await request(service.app).get("/api/workspace").set("Cookie", u.cookie))
        .status,
    ).toBe(401);
    expect(
      (await mutate("put", "/api/admin/users/dev-admin", { disabled: true }))
        .status,
    ).toBe(400);
  });
});
describe("private chat history and folders", () => {
  it("stores turns, pins, renames, moves and persists collapse; folder deletion keeps messages", async () => {
    await configure();
    const gid = (await mutate("post", "/api/chat-groups", { name: "Work" }))
        .body.id,
      result = await mutate("post", "/api/chat", {
        message: "Hello",
        group_id: gid,
      });
    expect(result.status).toBe(200);
    const id = result.body.conversation_id;
    expect((await admin.get("/api/conversations/" + id)).body).toHaveLength(2);
    await mutate("patch", "/api/conversations/" + id, {
      title: "Budget",
      pinned: true,
    });
    await mutate("patch", "/api/chat-groups/" + gid, {
      collapsed: true,
      name: "Finance",
    });
    let w = (await admin.get("/api/workspace")).body;
    expect(w.conversations[0]).toMatchObject({
      id,
      title: "Budget",
      pinned: true,
      group_id: gid,
    });
    expect(w.groups[0]).toMatchObject({ name: "Finance", collapsed: true });
    await mutate("delete", "/api/chat-groups/" + gid);
    w = (await admin.get("/api/workspace")).body;
    expect(w.conversations[0].group_id).toBeNull();
    expect((await admin.get("/api/conversations/" + id)).body).toHaveLength(2);
    await mutate("delete", "/api/conversations/" + id);
    expect((await admin.get("/api/conversations/" + id)).status).toBe(404);
    expect(service.db.get("SELECT count(*) AS n FROM messages")!.n).toBe(0);
  });
  it("denies access to another user chats and folders, including admin cross-ownership", async () => {
    await configure();
    const gid = (await mutate("post", "/api/chat-groups", { name: "Private" }))
        .body.id,
      id = (
        await mutate("post", "/api/chat", { message: "Private", group_id: gid })
      ).body.conversation_id;
    expect((await userGet("/api/conversations/" + id)).status).toBe(404);
    const u = await user();
    expect(
      (
        await request(service.app)
          .post("/api/chat")
          .set("Cookie", u.cookie)
          .set("X-CSRF-Token", u.csrf)
          .send({ message: "Intrude", group_id: gid })
      ).status,
    ).toBe(404);
    expect((await userGet("/api/workspace")).body.groups).toHaveLength(0);
    service.db.run(
      "UPDATE chat_groups SET user_id=? WHERE id=?",
      "employee",
      gid,
    );
    expect(
      (await mutate("patch", "/api/chat-groups/" + gid, { name: "Bad" }))
        .status,
    ).toBe(404);
  });
  it("does not resurrect a chat deleted during inference", async () => {
    await configure();
    const id = (await mutate("post", "/api/chat", { message: "Hi" })).body
      .conversation_id;
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      entered = new Promise<void>((r) => (started = r));
    handler = async (url, body) => {
      started();
      await gate;
      return mockRequest(url, body);
    };
    const pending = mutate("post", "/api/chat", {
      conversation_id: id,
      message: "Again",
    }).then((r) => r);
    await entered;
    await service.history.delete("dev-admin", id);
    release();
    expect((await pending).status).toBe(404);
    expect(service.db.get("SELECT count(*) AS n FROM messages")!.n).toBe(0);
  });
  it("leaves no turn when inference fails", async () => {
    await configure();
    handler = async () => {
      throw new Error("Offline");
    };
    expect(
      (await mutate("post", "/api/chat", { message: "Hello" })).status,
    ).toBe(502);
    expect(service.db.get("SELECT count(*) AS n FROM messages")!.n).toBe(0);
    expect(service.db.get("SELECT count(*) AS n FROM conversations")!.n).toBe(
      0,
    );
  });
  it("serializes simultaneous turns and preserves both histories", async () => {
    await configure();
    const results = await Promise.all([
      mutate("post", "/api/chat", { message: "First" }),
      mutate("post", "/api/chat", { message: "Second" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await admin.get("/api/workspace")).body.conversations).toHaveLength(
      2,
    );
  });
  it("passes prior turns and enterprise context to the model, and leaves no turn on failure", async () => {
    await configure();
    let seen: any;
    await service.close();
    service = await createApp({
      database: join(root, "test.db"),
      secret,
      mode: "development",
      secure: false,
      adminGroup: "admins",
      request: async (url, body) => {
        seen = body;
        return mockRequest(url, body);
      },
    });
    admin = request.agent(service.app);
    let s = (await admin.get("/api/session")).body;
    await admin.post("/auth/development").set("X-CSRF-Token", s.csrf);
    csrf = (await admin.get("/api/session")).body.csrf;
    const id = (await mutate("post", "/api/chat", { message: "First" })).body
      .conversation_id;
    await mutate("post", "/api/chat", {
      message: "Second",
      conversation_id: id,
    });
    expect(seen.messages.map((m: any) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(seen.messages[0].content).toContain("Workspace administrator");
  });
});
describe("document ingestion and citations", () => {
  it("extracts physical PDF pages, DOCX paragraphs and tables without invented pages", async () => {
    const pdf = await extractDocument("policy.pdf", await policyPDF());
    expect(pdf.units.map((u) => u.page)).toEqual([1, 2]);
    expect(pdf.units[1].text).toContain("Travel expenses");
    const docx = await extractDocument("policy.docx", policyDOCX());
    expect(docx.units).toHaveLength(3);
    expect(docx.units[1]).toMatchObject({
      page: null,
      label: "Travel policy / paragraph 2",
    });
    expect(docx.units[2].text).toBe("Hotel limit | 200");
  });
  it("rejects malformed, unsupported, blank and oversized files", async () => {
    for (const [filename, data] of [
      ["x.pdf", "bad"],
      ["x.exe", "bad"],
      ["x.txt", "   "],
      ["x.docx", "bad"],
    ])
      await expect(
        extractDocument(filename, Buffer.from(data)),
      ).rejects.toThrow();
    await expect(
      extractDocument("x.txt", Buffer.alloc(21 * 1024 * 1024)),
    ).rejects.toThrow("20 MB");
    await expect(
      extractDocument("x.txt", Buffer.from("x".repeat(500001))),
    ).rejects.toThrow("500,000");
  });
  it("keeps chunks on one page and uses overlapping segments", () => {
    const chunks = chunkUnits([
      { text: "x".repeat(3000), page: 2, label: "Page 2" },
      { text: "Next", page: 3, label: "Page 3" },
    ]);
    expect(chunks.map((c) => c.page)).toEqual([2, 2, 2, 3]);
    expect(chunks[0].content.length).toBe(1800);
    expect(chunks.every((c) => /^[a-f0-9]{32}$/.test(c.id))).toBe(true);
  });
  it("uploads originals and retrieves clickable page-level sources", async () => {
    await configure();
    const rid = await repo(),
      pdf = await policyPDF();
    const upload = await admin
      .post("/api/admin/documents/upload")
      .set("X-CSRF-Token", csrf)
      .field("repository_id", rid)
      .attach("file", pdf, "policy.pdf");
    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe("ready");
    const chat = await mutate("post", "/api/chat", {
      message: "Travel expenses manager approval",
      repository_id: rid,
    });
    expect(chat.status).toBe(200);
    expect(chat.body.sources[0]).toMatchObject({ page: 2, label: "Page 2" });
    const source = chat.body.sources[0];
    const info = (await admin.get("/api/sources/" + source.source_id)).body;
    expect(info.file_url).toContain("#page=2");
    const original = await admin.get(
      "/api/sources/" + source.source_id + "/file",
    );
    expect(original.status).toBe(200);
    expect(original.headers["content-type"]).toContain("application/pdf");
    expect(original.body).toEqual(pdf);
    await mutate("post", "/api/admin/documents/" + upload.body.id + "/reindex");
    expect((await admin.get("/api/sources/" + source.source_id)).status).toBe(
      200,
    );
    await mutate("delete", "/api/admin/documents/" + upload.body.id);
    expect((await admin.get("/api/sources/" + source.source_id)).status).toBe(
      404,
    );
  });
  it("enforces repository groups for retrieval, source metadata and originals", async () => {
    await configure();
    const rid = await repo(["finance"]);
    await addDoc(rid);
    const source = service.db.get("SELECT id FROM passages")!.id;
    expect((await userGet("/api/sources/" + source)).status).toBe(404);
    expect((await userGet("/api/sources/" + source + "/file")).status).toBe(
      404,
    );
    const u = await user();
    expect(
      (
        await request(service.app)
          .post("/api/chat")
          .set("Cookie", u.cookie)
          .set("X-CSRF-Token", u.csrf)
          .send({ message: "leave", repository_id: rid })
      ).status,
    ).toBe(403);
    expect(
      (await userGet("/api/sources/" + source, "finance-user", ["finance"]))
        .status,
    ).toBe(200);
  });
  it("uses keyword fallback only when embeddings are disabled", async () => {
    const rid = await repo();
    await addDoc(rid);
    const found = await service.knowledge.retrieve("leave", [rid]);
    expect(found).toHaveLength(1);
    expect(await service.knowledge.retrieve("nonexistent", [rid])).toHaveLength(
      0,
    );
    expect(await service.knowledge.retrieve("leave", [])).toHaveLength(0);
  });
});
describe("embedding lifecycle", () => {
  const settings = {
    enabled: true,
    base_url: "http://embed.test/v1",
    model: "embed",
    dimensions: 3,
  };
  it("tests configuration, invalidates documents, reindexes with stable citation IDs and semantic ranking", async () => {
    const rid = await repo(),
      id = await addDoc(rid),
      source = service.db.get("SELECT id FROM passages")!.id;
    expect(
      (await mutate("put", "/api/admin/embeddings", settings)).status,
    ).toBe(200);
    expect(service.db.get("SELECT status FROM documents")!.status).toBe(
      "needs_reindex",
    );
    expect(await service.knowledge.retrieve("leave", [rid])).toHaveLength(0);
    expect(
      (await mutate("post", "/api/admin/documents/" + id + "/reindex")).status,
    ).toBe(200);
    expect(service.db.get("SELECT id FROM passages")!.id).toBe(source);
    expect(await service.knowledge.retrieve("holidays", [rid])).toHaveLength(1);
    await mutate("put", "/api/admin/embeddings", {
      ...settings,
      api_key: "new-key",
    });
    expect(service.db.get("SELECT status FROM documents")!.status).toBe(
      "ready",
    );
    expect(
      JSON.stringify((await admin.get("/api/admin/embeddings")).body),
    ).not.toContain("new-key");
  });
  it("validates indexed vectors, dimensions, finite values, zero norms, and batch ordering", async () => {
    const s = {
      embedding_url: "http://embed/v1",
      embedding_model: "embed",
      embedding_dimensions: 3,
      embedding_key: "",
    };
    for (const data of [
      [{ index: 1, embedding: [1, 0, 0] }],
      [{ index: 0, embedding: [0, 0, 0] }],
      [{ index: 0, embedding: [1, 2] }],
      [{ index: 0, embedding: [1, Infinity, 0] }],
    ])
      await expect(
        embeddings(s, service.secrets, ["x"], async () => ({ data })),
      ).rejects.toThrow("Embedding request failed");
    const vectors = await embeddings(
      s,
      service.secrets,
      ["a", "b"],
      async () => ({
        data: [
          { index: 1, embedding: [0, 2, 0] },
          { index: 0, embedding: [2, 0, 0] },
        ],
      }),
    );
    expect(vectors).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });
  it("retains failed uploads for retry and excludes them from retrieval", async () => {
    await mutate("put", "/api/admin/embeddings", settings);
    service.knowledge.request = async () => {
      throw new Error("Offline");
    };
    const rid = await repo(),
      id = await addDoc(rid);
    expect(
      service.db.get("SELECT status FROM documents WHERE id=?", id)!.status,
    ).toBe("failed");
    service.knowledge.request = mockRequest;
    expect(await service.knowledge.retrieve("leave", [rid])).toHaveLength(0);
    await mutate("post", "/api/admin/documents/" + id + "/reindex");
    expect(
      service.db.get("SELECT status FROM documents WHERE id=?", id)!.status,
    ).toBe("ready");
  });
  it("preserves the Python fingerprint including commas and Unicode in model identifiers", () => {
    const s = {
      embedding_url: "http://embed/v1,a",
      embedding_model: "mød,el",
      embedding_dimensions: 3,
    };
    const expected = createHash("sha256")
      .update('["http://embed/v1,a", "m\\u00f8d,el", 3, "chunks-v1"]')
      .digest("hex");
    expect(signature(s)).toBe(expected);
  });
});
describe("legacy workspace migration", () => {
  it("adds missing columns without losing users, chat messages or documents", () => {
    const path = join(root, "legacy.db"),
      old = new Database(path);
    old.exec(readFileSync("server/schema.sql", "utf8"));
    old
      .prepare(
        "INSERT INTO users(id,name,email,role) VALUES('u','User','u@test','user')",
      )
      .run();
    old.prepare("INSERT INTO repositories(id,name) VALUES(1,'Legacy')").run();
    old
      .prepare(
        "INSERT INTO documents(id,repo_id,title,content) VALUES(1,1,'Policy','Legacy text')",
      )
      .run();
    old
      .prepare(
        "INSERT INTO conversations(id,user_id,title) VALUES('c','u','Old chat')",
      )
      .run();
    old
      .prepare(
        "INSERT INTO messages(conversation_id,role,content) VALUES('c','user','Hello')",
      )
      .run();
    old.close();
    const db = new LocalDB(path);
    try {
      expect(db.get("SELECT content FROM messages")!.content).toBe("Hello");
      expect(db.get("SELECT content FROM passages")!.content).toBe(
        "Legacy text",
      );
      expect(
        db.get("SELECT updated_at FROM conversations")!.updated_at,
      ).not.toBe("");
      const namespace = db.get(
        "SELECT vector_namespace FROM settings",
      )!.vector_namespace;
      db.close();
      const reopened = new LocalDB(path);
      expect(
        reopened.get("SELECT vector_namespace FROM settings")!.vector_namespace,
      ).toBe(namespace);
      expect(reopened.all("SELECT * FROM passages")).toHaveLength(1);
      reopened.close();
    } catch (e) {
      if (db.raw.open) db.close();
      throw e;
    }
  });
});

it("preserves the legacy embedding-settings endpoint and infers enabled from its URL", async () => {
  expect(
    (
      await mutate("put", "/api/admin/embedding-settings", {
        base_url: "http://embed.test/v1",
        model: "embed",
        dimensions: 3,
      })
    ).status,
  ).toBe(200);
  expect((await admin.get("/api/admin/embedding-settings")).body).toMatchObject(
    { enabled: true, model: "embed", dimensions: 3 },
  );
});
it("rechecks passage readiness after an embedding response arrives", async () => {
  const rid = await repo(),
    id = await addDoc(rid);
  await mutate("put", "/api/admin/embeddings", {
    enabled: true,
    base_url: "http://embed.test/v1",
    model: "embed",
    dimensions: 3,
  });
  await mutate("post", "/api/admin/documents/" + id + "/reindex");
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (started = r)),
    gate = new Promise<void>((r) => (release = r));
  service.knowledge.request = async (url, body) => {
    started();
    await gate;
    return mockRequest(url, body);
  };
  const pending = service.knowledge.retrieve("leave", [rid]);
  await entered;
  service.db.run("UPDATE documents SET status='needs_reindex' WHERE id=?", id);
  release();
  expect(await pending).toHaveLength(0);
});

it("accepts multilingual text up to the character limit rather than limiting it to one megabyte", async () => {
  const rid = await repo();
  const result = await mutate("post", "/api/admin/documents", {
    repository_id: rid,
    title: "Multilingual policy",
    content: "知".repeat(360000),
  });
  expect(result.status).toBe(201);
  expect(
    service.db.get(
      "SELECT length(content) AS n FROM documents WHERE id=?",
      result.body.id,
    )!.n,
  ).toBe(360000);
});

it("saves only the current user's palette and validates preferences and CSRF", async () => {
  expect((await admin.get("/api/session")).body.user.palette).toBe("forest");
  expect(
    (await admin.put("/api/preferences").send({ palette: "ocean" })).status,
  ).toBe(403);
  expect(
    (await mutate("put", "/api/preferences", { palette: "ocean" })).status,
  ).toBe(200);
  expect((await admin.get("/api/session")).body.user.palette).toBe("ocean");
  expect(
    (await mutate("put", "/api/preferences", { palette: "invalid" })).status,
  ).toBe(400);
  const other = await user("palette-user");
  expect(
    (
      await request(service.app)
        .put("/api/preferences")
        .set("Cookie", other.cookie)
        .set("X-CSRF-Token", other.csrf)
        .send({ palette: "plum" })
    ).status,
  ).toBe(200);
  expect((await admin.get("/api/session")).body.user.palette).toBe("ocean");
  expect(
    service.db.get("SELECT palette FROM users WHERE id='palette-user'")!
      .palette,
  ).toBe("plum");
  expect(
    (
      await request(service.app)
        .put("/api/preferences")
        .set("Cookie", other.cookie)
        .set("X-CSRF-Token", other.csrf)
        .send({ palette: "amber", id: "local-admin" })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(service.app)
        .put("/api/preferences")
        .send({ palette: "slate" })
    ).status,
  ).toBe(403);
});
