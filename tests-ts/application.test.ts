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
import { Sessions } from "../server/sessions";
import Database from "better-sqlite3";
import { createApp, Config } from "../server/app";
import {
  extractDocument,
  chunkUnits,
  signature,
  embeddings,
  InferenceHTTPError,
  requestJSON,
} from "../server/knowledge";
import { Secrets, LocalDB } from "../server/db";
import { RequestJSON } from "../server/knowledge";
import { memoryStorage, storageInput } from "./storage-fixture";
import { policyPDF, policyDOCX, mockRequest } from "./fixtures";
import { splitThinking } from "../shared/thinking";
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
it("separates saved thinking, sends the switch to vLLM, and excludes thoughts from subsequent context", async () => {
  await configure();
  await mutate("put", "/api/admin/settings", {
    base_url: "http://model.test/v1",
    model: "local",
    display_name: "Raazi Assistant",
    thinking_control: "enable_thinking",
    system_prompt: "Be helpful.",
    api_key: "",
  });
  expect((await admin.get("/api/workspace")).body.models[0]).toMatchObject({
    label: "Raazi Assistant",
    supports_thinking: true,
  });
  await configure(); // An older settings client must preserve the new metadata.
  expect((await admin.get("/api/workspace")).body.models[0]).toMatchObject({
    label: "Raazi Assistant",
    supports_thinking: true,
  });
  const calls: any[] = [];
  handler = async (_url, body) => {
    calls.push(body);
    return {
      choices: [
        {
          message:
            calls.length === 1
              ? { content: "<think>Private model steps.</think>Final answer." }
              : {
                  content: "Next answer.",
                  reasoning_content: "Separate model steps.",
                },
        },
      ],
    };
  };
  const first = await mutate("post", "/api/chat", {
    message: "First",
    thinking: true,
  });
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({
    content: "Final answer.",
    reasoning: "Private model steps.",
  });
  expect(calls[0].chat_template_kwargs).toEqual({ enable_thinking: true });
  const stored = (
    await admin.get("/api/conversations/" + first.body.conversation_id)
  ).body;
  expect(stored[1]).toMatchObject({
    content: "Final answer.",
    reasoning: "Private model steps.",
  });
  const second = await mutate("post", "/api/chat", {
    message: "Next",
    conversation_id: first.body.conversation_id,
    thinking: false,
  });
  expect(second.body).toMatchObject({
    content: "Next answer.",
    reasoning: "Separate model steps.",
  });
  expect(calls[1].chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(JSON.stringify(calls[1].messages)).not.toContain(
    "Private model steps",
  );
  // Older saved marked content is separated on read without modifying the stored original.
  service.db.run(
    "UPDATE messages SET content=?,reasoning='' WHERE id=?",
    "<think>Old steps.</think>Old answer.",
    stored[1].id,
  );
  expect(
    (await admin.get("/api/conversations/" + first.body.conversation_id))
      .body[1],
  ).toMatchObject({ content: "Old answer.", reasoning: "Old steps." });
});

it("keeps per-model aliases and thinking controls separate from inference IDs", async () => {
  const provider = {
    name: "Local engine",
    kind: "openai-compatible",
    base_url: "http://model.test/v1",
    models: ["org/cryptic-model", "ordinary"],
    model_options: {
      "org/cryptic-model": {
        display_name: "SNGPL Expert",
        thinking_control: "thinking",
      },
    },
  };
  const created = await mutate("post", "/api/admin/providers", provider);
  expect(created.status).toBe(200);
  const info = (await admin.get("/api/admin/providers")).body;
  const model = info.models.find((m: any) => m.label === "SNGPL Expert");
  expect(model.supports_thinking).toBe(true);
  let call: any;
  handler = async (_url, body) => {
    call = body;
    return {
      choices: [
        { message: { content: "Answer", reasoning: "Engine reasoning" } },
      ],
    };
  };
  const result = await mutate("post", "/api/chat", {
    message: "Hello",
    model_key: model.key,
    thinking: true,
  });
  expect(result.body.reasoning).toBe("Engine reasoning");
  expect(call.model).toBe("org/cryptic-model");
  expect(call.chat_template_kwargs).toEqual({ thinking: true });
  const { model_options, ...oldClient } = provider;
  expect(
    (await mutate("put", "/api/admin/providers/" + created.body.id, oldClient))
      .status,
  ).toBe(200);
  expect((await admin.get("/api/admin/providers")).body.models).toContainEqual(
    model,
  );
  const ordinary = info.models.find((m: any) =>
    m.label.endsWith(" / ordinary"),
  );
  await mutate("post", "/api/chat", {
    message: "Hello",
    model_key: ordinary.key,
    thinking: true,
  });
  expect(call).not.toHaveProperty("chat_template_kwargs");
  expect(
    (
      await mutate("put", "/api/admin/providers/" + created.body.id, {
        ...provider,
        model_options: { unknown: { display_name: "Wrong" } },
      })
    ).status,
  ).toBe(400);
});

it("preserves prose and code mentioning thinking tags and rejects reasoning-only completions without saving", async () => {
  expect(splitThinking("Use `<think>` tags in code.")).toEqual({
    content: "Use `<think>` tags in code.",
    reasoning: "",
  });
  expect(splitThinking("<think></think>\nAnswer").content).toBe("Answer");
  expect(splitThinking("<THINK>Steps</THINK>Answer").reasoning).toBe("Steps");
  expect(splitThinking("Model steps.\n</think>\n\nFinal answer.")).toEqual({
    content: "Final answer.",
    reasoning: "Model steps.",
  });
  expect(splitThinking("```xml\n</think>\n```\nExplanation.")).toEqual({
    content: "```xml\n</think>\n```\nExplanation.",
    reasoning: "",
  });
  await configure();
  handler = async () => ({
    choices: [{ message: { content: "<think>Unfinished reasoning" } }],
  });
  expect((await mutate("post", "/api/chat", { message: "Hello" })).status).toBe(
    502,
  );
  expect(service.db.all("SELECT * FROM conversations")).toHaveLength(0);
});
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
    cookie = await new SignJWT({
      uid: id,
      csrf,
      sid: new Sessions(service.db).create(id, "Fixture browser"),
    })
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
it("lists sessions only for admins, distinguishes activity, and revokes one or all user sessions", async () => {
  const first = await user("session-user"),
    second = await user("session-user");
  const firstId = service.db.all(
    "SELECT id FROM login_sessions WHERE user_id=? ORDER BY created_at",
    "session-user",
  )[0].id;
  service.db.run(
    "UPDATE login_sessions SET last_seen_at=? WHERE id=?",
    Date.now() - 10 * 60000,
    firstId,
  );
  const listed = await admin.get("/api/admin/sessions");
  expect(listed.status).toBe(200);
  expect(
    listed.body.sessions.filter((s: any) => s.user_id === "session-user"),
  ).toHaveLength(2);
  expect(
    listed.body.sessions.find((s: any) => s.id === firstId).recently_active,
  ).toBe(false);
  expect(listed.body.sessions.find((s: any) => s.current).user_id).toBe(
    "dev-admin",
  );
  expect(JSON.stringify(listed.body)).not.toContain("raazi_session=");
  expect(
    (
      await request(service.app)
        .get("/api/admin/sessions")
        .set("Cookie", first.cookie)
    ).status,
  ).toBe(403);
  expect((await admin.delete("/api/admin/sessions/" + firstId)).status).toBe(
    403,
  );
  expect(
    (await mutate("delete", "/api/admin/sessions/" + firstId)).status,
  ).toBe(200);
  expect(
    (
      await request(service.app)
        .get("/api/workspace")
        .set("Cookie", first.cookie)
    ).status,
  ).toBe(401);
  expect(
    (
      await request(service.app)
        .get("/api/workspace")
        .set("Cookie", second.cookie)
    ).status,
  ).toBe(200);
  expect(
    (await mutate("delete", "/api/admin/users/session-user/sessions")).body
      .count,
  ).toBe(1);
  expect(
    (
      await request(service.app)
        .get("/api/session")
        .set("Cookie", second.cookie)
    ).body.user,
  ).toBeNull();
  expect(
    service.db.all("SELECT action FROM audit WHERE action LIKE 'Ended %'"),
  ).toHaveLength(2);
  const mine = (await admin.get("/api/admin/sessions")).body.sessions.find(
    (s: any) => s.current,
  );
  expect(
    (await mutate("delete", "/api/admin/sessions/" + mine.id)).body
      .current_ended,
  ).toBe(true);
  expect((await admin.get("/api/workspace")).status).toBe(401);
});

it("rejects legacy untracked cookies, expires registered sessions, and prevents revoked requests saving inference", async () => {
  const employee = await user("session-user");
  const oldCookie = await new SignJWT({ uid: "session-user", csrf: "old-csrf" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("raazi")
    .setAudience("raazi-session")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
  expect(
    (
      await request(service.app)
        .get("/api/workspace")
        .set("Cookie", "raazi_session=" + oldCookie)
    ).status,
  ).toBe(401);
  service.db.run(
    "UPDATE login_sessions SET expires_at=? WHERE user_id=?",
    Date.now() - 1000,
    "session-user",
  );
  expect(
    (
      await request(service.app)
        .get("/api/workspace")
        .set("Cookie", employee.cookie)
    ).status,
  ).toBe(401);
  await configure();
  handler = async () => {
    new Sessions(service.db).revokeUser("dev-admin");
    return { choices: [{ message: { content: "Do not save this" } }] };
  };
  expect(
    (await mutate("post", "/api/chat", { message: "Long request" })).status,
  ).toBe(401);
  expect(service.db.all("SELECT * FROM conversations")).toHaveLength(0);
});

it("retains session registration across restart, and logout revokes a captured cookie", async () => {
  const employee = await user("session-user");
  await service.close();
  service = await createApp({
    database: join(root, "test.db"),
    secret,
    mode: "development",
    secure: false,
    adminGroup: "admins",
    request: mockRequest,
  });
  expect(
    (
      await request(service.app)
        .get("/api/workspace")
        .set("Cookie", employee.cookie)
    ).status,
  ).toBe(200);
  expect(
    (
      await request(service.app)
        .post("/auth/logout")
        .set("Cookie", employee.cookie)
        .set("X-CSRF-Token", employee.csrf)
    ).status,
  ).toBe(200);
  expect(
    (
      await request(service.app)
        .get("/api/workspace")
        .set("Cookie", employee.cookie)
    ).status,
  ).toBe(401);
});
it("passive checks do not mark an idle user active, and disabling then re-enabling does not restore their session", async () => {
  const employee = await user("session-user");
  const idle = Date.now() - 10 * 60000;
  service.db.run(
    "UPDATE login_sessions SET last_seen_at=? WHERE user_id=?",
    idle,
    "session-user",
  );
  expect(
    (
      await request(service.app)
        .get("/api/session")
        .set("Cookie", employee.cookie)
    ).body.user.id,
  ).toBe("session-user");
  expect(
    service.db.get(
      "SELECT last_seen_at FROM login_sessions WHERE user_id=?",
      "session-user",
    )!.last_seen_at,
  ).toBe(idle);
  const profile = {
    department: "",
    job_title: "",
    profile: "",
    disabled: true,
  };
  expect(
    (await mutate("put", "/api/admin/users/session-user", profile)).status,
  ).toBe(200);
  expect(
    (
      await mutate("put", "/api/admin/users/session-user", {
        ...profile,
        disabled: false,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(service.app)
        .get("/api/workspace")
        .set("Cookie", employee.cookie)
    ).status,
  ).toBe(401);
});
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
  it("tests embedding connection without saving or invalidating documents", async () => {
    await addDoc(await repo());
    const before = service.db.get("SELECT * FROM settings WHERE id=1");
    const result = await mutate("post", "/api/admin/embeddings/test", {
      base_url: "http://embed.test/v1",
      model: "embed",
      dimensions: 3,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, model: "embed", dimensions: 3 });
    expect(service.db.get("SELECT * FROM settings WHERE id=1")).toEqual(before);
    expect(service.db.get("SELECT status FROM documents")!.status).toBe(
      "ready",
    );
  });

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
      expect(db.get("SELECT reasoning FROM messages")!.reasoning).toBe("");
      expect(
        db.get("SELECT display_name,thinking_control FROM settings"),
      ).toMatchObject({ display_name: "", thinking_control: "none" });
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

it("edits and resends questions only after successful inference and preserves prior context", async () => {
  await configure();
  const first = await mutate("post", "/api/chat", {
      message: "First question",
    }),
    cid = first.body.conversation_id;
  await mutate("post", "/api/chat", {
    conversation_id: cid,
    message: "Later question",
  });
  let saved = (await admin.get("/api/conversations/" + cid)).body,
    old = saved[0].id;
  let sent: any;
  handler = async (url, body) => {
    sent = body;
    return mockRequest(url, body);
  };
  const edited = await mutate("post", "/api/chat", {
    conversation_id: cid,
    message: "Revised first question",
    edit_message_id: String(old),
  });
  expect(edited.status).toBe(200);
  expect(sent.messages.map((m: any) => m.content).join("\n")).not.toContain(
    "Later question",
  );
  saved = (await admin.get("/api/conversations/" + cid)).body;
  expect(saved).toHaveLength(2);
  expect(saved[0].content).toBe("Revised first question");
  handler = async () => {
    throw new Error("Model offline");
  };
  expect(
    (
      await mutate("post", "/api/chat", {
        conversation_id: cid,
        message: "Failed edit",
        edit_message_id: String(saved[0].id),
      })
    ).status,
  ).toBe(502);
  expect((await admin.get("/api/conversations/" + cid)).body).toEqual(saved);
  handler = mockRequest;
  expect(
    (
      await mutate("post", "/api/chat", {
        conversation_id: cid,
        message: "Invalid",
        edit_message_id: String(saved[1].id),
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "No chat",
        edit_message_id: "1",
      })
    ).status,
  ).toBe(400);
  const other = await user("edit-stranger");
  expect(
    (
      await request(service.app)
        .post("/api/chat")
        .set("Cookie", other.cookie)
        .set("X-CSRF-Token", other.csrf)
        .send({
          conversation_id: cid,
          message: "Stolen",
          edit_message_id: String(saved[0].id),
        })
    ).status,
  ).toBe(404);
});
it("rejects an edit when another answer changes the chat during inference", async () => {
  await configure();
  const cid = (await mutate("post", "/api/chat", { message: "Original" })).body
    .conversation_id;
  const before = (await admin.get("/api/conversations/" + cid)).body;
  handler = async (url, body) => {
    await service.history.append(
      "dev-admin",
      cid,
      "Concurrent question",
      "Concurrent answer",
      [],
      null,
    );
    return mockRequest(url, body);
  };
  expect(
    (
      await mutate("post", "/api/chat", {
        conversation_id: cid,
        message: "Edited",
        edit_message_id: String(before[0].id),
      })
    ).status,
  ).toBe(409);
  const after = (await admin.get("/api/conversations/" + cid)).body;
  expect(after).toHaveLength(4);
  expect(after[0].content).toBe("Original");
  expect(after[2].content).toBe("Concurrent question");
});

it("detects concurrent rewrites when SQLite reuses message IDs", async () => {
  await configure();
  const cid = (
    await mutate("post", "/api/chat", { message: "Original question" })
  ).body.conversation_id;
  const saved = (await admin.get("/api/conversations/" + cid)).body;
  const conversation = await service.history.owned("dev-admin", cid);
  handler = async (url, body) => {
    await service.history.append(
      "dev-admin",
      cid,
      "Winning edit",
      "Winning answer",
      [],
      null,
      [],
      {
        messageId: String(saved[0].id),
        tailId: String(saved.at(-1).id),
        version: conversation.version,
      },
    );
    return mockRequest(url, body);
  };
  expect(
    (
      await mutate("post", "/api/chat", {
        conversation_id: cid,
        message: "Stale edit",
        edit_message_id: String(saved[0].id),
      })
    ).status,
  ).toBe(409);
  const after = (await admin.get("/api/conversations/" + cid)).body;
  expect(after).toHaveLength(2);
  expect(after[0].content).toBe("Winning edit");
});

it("keeps composer shades private and independent from accent colors", async () => {
  expect((await admin.get("/api/session")).body.user.composer_shade).toBe(
    "mist",
  );
  await mutate("put", "/api/preferences", { palette: "ocean" });
  expect(
    (await mutate("put", "/api/preferences", { composer_shade: "sky" })).body,
  ).toEqual({
    palette: "ocean",
    composer_shade: "sky",
    composer_size: "compact",
  });
  await mutate("put", "/api/preferences", { palette: "plum" });
  expect((await admin.get("/api/session")).body.user.composer_shade).toBe(
    "sky",
  );
  expect(
    (await mutate("put", "/api/preferences", { composer_shade: "dark" }))
      .status,
  ).toBe(400);
  expect((await mutate("put", "/api/preferences", {})).status).toBe(400);
  const other = await user("shade-user");
  expect(
    (await request(service.app).get("/api/session").set("Cookie", other.cookie))
      .body.user.composer_shade,
  ).toBe("mist");
});

it("saves labeled demo replies without calling a model, and stops demo mode after configuration", async () => {
  const calls = vi.fn(mockRequest);
  handler = calls;
  expect((await admin.get("/api/workspace")).body.demo_mode).toBe(true);
  const reply = await mutate("post", "/api/chat", {
    message: "Test scrolling",
    conversation_id: "",
  });
  expect(reply.status).toBe(200);
  expect(reply.body.content).toContain("## Demo response");
  expect(reply.body.content).toContain("No model was called");
  expect(reply.body.content.length).toBeGreaterThan(4000);
  expect(reply.body.sources).toEqual([]);
  expect(calls).not.toHaveBeenCalled();
  const id = reply.body.conversation_id;
  const saved = await admin.get("/api/conversations/" + id);
  expect(saved.body).toHaveLength(2);
  expect(saved.body[1].content).toBe(reply.body.content);
  expect((await userGet("/api/conversations/" + id)).status).toBe(404);
  await configure();
  expect((await admin.get("/api/workspace")).body.demo_mode).toBe(false);
  const real = await mutate("post", "/api/chat", {
    message: "Hello",
    conversation_id: id,
  });
  expect(real.status).toBe(200);
  expect(real.body.content).not.toContain("## Demo response");
  expect(calls).toHaveBeenCalledOnce();
});

it("persists composer sizes without changing colors or another user's size", async () => {
  expect((await admin.get("/api/session")).body.user.composer_size).toBe(
    "compact",
  );
  expect(
    (await mutate("put", "/api/preferences", { composer_size: "spacious" }))
      .status,
  ).toBe(200);
  await mutate("put", "/api/preferences", {
    palette: "plum",
    composer_shade: "ivory",
  });
  expect((await admin.get("/api/session")).body.user).toMatchObject({
    composer_size: "spacious",
    palette: "plum",
    composer_shade: "ivory",
  });
  expect(
    (await mutate("put", "/api/preferences", { composer_size: "huge" })).status,
  ).toBe(400);
  const other = await user("size-user");
  expect(
    (await request(service.app).get("/api/session").set("Cookie", other.cookie))
      .body.user.composer_size,
  ).toBe("compact");
});

async function addProvider(
  name: string,
  kind: "openai-compatible" | "typesafe",
  models: string[],
  purpose = kind === "typesafe" ? "decision" : "chat",
) {
  const result = await mutate("post", "/api/admin/providers", {
    name,
    kind,
    models,
    purpose,
    base_url: "http://" + name.toLowerCase() + ".test/v1",
    enabled: true,
    api_key: "fixture-provider-key",
  });
  expect(result.status).toBe(200);
  return result.body.id as string;
}
function decisionReply(action = "knowledge", target = "m0", confidence = 0.95) {
  return {
    answers: {
      action: {
        type: "choice",
        choice: action,
        confidence,
        probabilities: {
          direct: action === "direct" ? 1 : 0,
          knowledge: action === "knowledge" ? 1 : 0,
          clarify: action === "clarify" ? 1 : 0,
        },
      },
      target: {
        type: "choice",
        choice: target,
        confidence,
        probabilities: {
          m0: target === "m0" ? 1 : 0,
          m1: target === "m1" ? 1 : 0,
        },
      },
    },
  };
}
it("discovers multiple models, exposes only approved models, and keeps provider keys private", async () => {
  const id = await addProvider("Local", "openai-compatible", [
    "small",
    "large",
  ]);
  const jev = await addProvider("Jev", "typesafe", ["jev-latest"]);
  expect((await userGet("/api/admin/providers")).status).toBe(403);
  const info = (await admin.get("/api/admin/providers")).body;
  expect(JSON.stringify(info)).not.toContain("fixture-provider-key");
  expect(
    service.db.get("SELECT api_key FROM model_providers WHERE id=?", id)!
      .api_key,
  ).toMatch(/^v2:/);
  const workspace = (await admin.get("/api/workspace")).body;
  expect(workspace.models.map((m: any) => m.label)).toEqual([
    "Local / small",
    "Local / large",
  ]);
  expect(JSON.stringify(workspace)).not.toContain(".test/v1");
  expect(workspace.demo_mode).toBe(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: [{ id: "small" }, { id: "new-model" }, { id: "small" }],
      }),
    ),
  );
  const found = await mutate(
    "post",
    "/api/admin/providers/" + id + "/discover",
    {},
  );
  expect(found.body.models).toEqual(["new-model", "small"]);
  expect((await admin.get("/api/workspace")).body.models).toHaveLength(2);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ models: [{ name: "jev-latest" }] })),
  );
  expect(
    (await mutate("post", "/api/admin/providers/" + jev + "/discover", {})).body
      .models,
  ).toEqual(["jev-latest"]);
  const call = vi.fn(mockRequest);
  handler = call;
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "Hello",
        model_key: workspace.models[1].key,
      })
    ).status,
  ).toBe(200);
  expect((call.mock.calls[0][1] as any).model).toBe("large");
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "Hello",
        model_key: "unapproved",
      })
    ).status,
  ).toBe(400);
});
it("routes through Jev without searching unselected shared knowledge", async () => {
  await configure();
  const local = await addProvider("Alt", "openai-compatible", ["expert"]);
  const jev = await addProvider("Jev", "typesafe", ["jev-latest"]);
  expect(
    (
      await mutate("put", "/api/admin/routing", {
        enabled: true,
        provider_id: jev,
        model: "jev-latest",
        threshold: 0.8,
      })
    ).status,
  ).toBe(200);
  const rid = await repo();
  await addDoc(rid);
  const calls: { url: string; body: any }[] = [];
  handler = async (url, body, key) => {
    calls.push({ url, body });
    if (url.endsWith("/systemone")) return decisionReply("knowledge", "m1");
    return mockRequest(url, body);
  };
  const answer = await mutate("post", "/api/chat", {
    message: "Annual leave allowance",
    use_decision: true,
  });
  expect(answer.status).toBe(200);
  expect(answer.body.content).toContain("Decision route: direct");
  expect(answer.body.content).toContain("Alt / expert");
  expect(answer.body.sources).toEqual([]);
  expect(calls[0].url).toBe("http://jev.test/v1/systemone");
  expect(calls[0].body.questions.target.criteria.m1).toBe("Alt / expert");
  expect(calls[1].url).toBe("http://alt.test/v1/chat/completions");
  expect(calls[1].body.model).toBe("expert");
  expect(
    (await admin.get("/api/conversations/" + answer.body.conversation_id))
      .body[1].content,
  ).toBe(answer.body.content);
  expect((await mutate("delete", "/api/admin/providers/" + jev)).status).toBe(
    400,
  );
  const denied = await repo(["restricted"]);
  const count = calls.length;
  const employee = await user("routing-employee");
  expect(
    (
      await request(service.app)
        .post("/api/chat")
        .set("Cookie", employee.cookie)
        .set("X-CSRF-Token", employee.csrf)
        .send({
          message: "Annual leave",
          use_decision: true,
          repository_id: denied,
        })
    ).status,
  ).toBe(403);
  expect(calls).toHaveLength(count);
  expect(local).toBeTruthy();
});
it("low decision confidence asks for clarification; routing errors preserve saved chat", async () => {
  await configure();
  await addProvider("Alt", "openai-compatible", ["expert"]);
  const jev = await addProvider("Jev", "typesafe", ["jev-latest"]);
  await mutate("put", "/api/admin/routing", {
    enabled: true,
    provider_id: jev,
    model: "jev-latest",
    threshold: 0.8,
  });
  let calls = 0;
  handler = async () => {
    calls++;
    return decisionReply("direct", "m1", 0.6);
  };
  const reply = await mutate("post", "/api/chat", {
    message: "Explain this",
    use_decision: true,
  });
  expect(reply.status).toBe(200);
  expect(reply.body.content).toContain("not confident enough");
  expect(calls).toBe(1);
  const id = reply.body.conversation_id,
    before = (await admin.get("/api/conversations/" + id)).body;
  handler = async () => decisionReply("knowledge", "m99");
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "Retry",
        conversation_id: id,
        use_decision: true,
        edit_message_id: String(before[0].id),
      })
    ).status,
  ).toBe(502);
  expect((await admin.get("/api/conversations/" + id)).body).toEqual(before);
  handler = async () => {
    throw new Error("Offline");
  };
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "Retry",
        conversation_id: id,
        use_decision: true,
      })
    ).status,
  ).toBe(502);
  expect((await admin.get("/api/conversations/" + id)).body).toEqual(before);
});
it("enforces administrator routing regardless of the legacy chat switch", async () => {
  await configure();
  await addProvider("Alt", "openai-compatible", ["expert"]);
  const decision = await addProvider(
    "Router",
    "openai-compatible",
    ["router-model"],
    "decision",
  );
  await mutate("put", "/api/admin/routing", {
    enabled: true,
    provider_id: decision,
    model: "router-model",
    threshold: 0.8,
  });
  const calls: string[] = [];
  handler = async (url, body, key) => {
    calls.push(url);
    if (url.includes("router.test"))
      return {
        choices: [
          {
            message: { content: JSON.stringify(decisionReply("direct", "m1")) },
          },
        ],
      };
    return mockRequest(url, body);
  };
  const reply = await mutate("post", "/api/chat", {
    message: "Hello",
    use_decision: true,
  });
  expect(reply.status).toBe(200);
  expect(reply.body.sources).toEqual([]);
  expect(calls).toEqual([
    "http://router.test/v1/chat/completions",
    "http://alt.test/v1/chat/completions",
  ]);
  calls.length = 0;
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "Hello",
        use_decision: false,
      })
    ).status,
  ).toBe(200);
  expect(calls).toEqual([
    "http://router.test/v1/chat/completions",
    "http://alt.test/v1/chat/completions",
  ]);
  await mutate("put", "/api/admin/routing", {
    enabled: false,
    provider_id: decision,
    model: "router-model",
    threshold: 0.8,
  });
  calls.length = 0;
  await mutate("post", "/api/chat", { message: "Hello", use_decision: true });
  expect(calls).toEqual(["http://model.test/v1/chat/completions"]);
});

it("routes image chats only to approved vision models and keeps image bytes out of decision state", async () => {
  await configure();
  const vision = (
    await mutate("post", "/api/admin/providers", {
      name: "Vision",
      kind: "openai-compatible",
      base_url: "http://vision.test/v1",
      models: ["vision"],
      supports_images: true,
    })
  ).body.id;
  const jev = await addProvider("Jev", "typesafe", ["jev-latest"]);
  await mutate("put", "/api/admin/routing", {
    enabled: true,
    provider_id: jev,
    model: "jev-latest",
    threshold: 0.8,
  });
  const sharp = (await import("sharp")).default;
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "#008888" },
  })
    .png()
    .toBuffer();
  const file = await admin
    .post("/api/attachments")
    .set("X-CSRF-Token", csrf)
    .attach("file", image, "diagram.png");
  expect(file.status).toBe(201);
  const calls: { url: string; body: any }[] = [];
  handler = async (url, body) => {
    calls.push({ url, body });
    if (url.endsWith("/systemone"))
      return {
        answers: {
          action: {
            type: "choice",
            choice: "direct",
            confidence: 0.9,
            probabilities: { direct: 1, knowledge: 0, clarify: 0 },
          },
          target: {
            type: "choice",
            choice: "m0",
            confidence: 0.9,
            probabilities: { m0: 1 },
          },
        },
      };
    return { choices: [{ message: { content: "Image description" } }] };
  };
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "Explain",
        model_key: "default",
        attachment_ids: [file.body.id],
      })
    ).status,
  ).toBe(200);
  expect(calls).toHaveLength(2);
  calls.length = 0;
  const reply = await mutate("post", "/api/chat", {
    message: "Explain",
    use_decision: true,
    attachment_ids: [file.body.id],
  });
  expect(reply.status).toBe(200);
  expect(calls[0].body.questions.target.criteria).toEqual({
    m0: "Vision / vision",
  });
  expect(JSON.stringify(calls[0].body)).not.toContain("base64");
  expect(calls[1].url).toBe("http://vision.test/v1/chat/completions");
  expect(calls[1].body.messages.at(-1).content[1].type).toBe("image_url");
  expect(vision).toBeTruthy();
});

it("tests model inference without saving settings or chat history", async () => {
  await configure();
  const before = service.db.get("SELECT * FROM settings WHERE id=1");
  let usedKey = "";
  handler = async (_url, _body, key) => {
    usedKey = key;
    return { choices: [{ message: { content: "OK" } }] };
  };
  const result = await mutate("post", "/api/admin/model/test", {
    base_url: "http://model.test/v1",
    model: "local",
  });
  expect(result.status).toBe(200);
  expect(usedKey).toBe("model-secret");
  expect(service.db.get("SELECT * FROM settings WHERE id=1")).toEqual(before);
  expect(service.db.all("SELECT * FROM conversations")).toHaveLength(0);
  handler = async () => ({ choices: [] });
  expect(
    (
      await mutate("post", "/api/admin/model/test", {
        base_url: "http://model.test/v1",
        model: "local",
      })
    ).status,
  ).toBe(502);
});

it("reports live embedding progress and marks a changed model stale", async () => {
  const id = await addDoc(await repo());
  await mutate("put", "/api/admin/embeddings", {
    enabled: true,
    base_url: "http://embed.test/v1",
    model: "embed",
    dimensions: 3,
  });
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  handler = async (url, body, key) => {
    entered();
    await pending;
    return mockRequest(url, body);
  };
  const work = mutate("post", "/api/admin/documents/" + id + "/reindex").then(
    (r) => r,
  );
  await started;
  try {
    const response = await admin.get("/api/admin/documents/status");
    expect(response.status).toBe(200);
    expect(response.body.documents[0]).toMatchObject({
      status: "processing",
      index_stage: "Creating embeddings",
      index_completed: 0,
    });
    expect(response.body.documents[0].index_total).toBeGreaterThan(0);
    expect(
      (await request(service.app).get("/api/admin/documents/status")).status,
    ).toBe(401);
  } finally {
    release();
  }
  expect((await work).status).toBe(200);
  const ready = service.knowledge.documents()[0];
  expect(ready.index_completed).toBe(ready.index_total);
  expect(ready.index_stage).toBe("Ready");
  handler = mockRequest;
  await mutate("put", "/api/admin/embeddings", {
    enabled: true,
    base_url: "http://embed.test/v1",
    model: "replacement",
    dimensions: 3,
  });
  expect(service.knowledge.documents()[0].status).toBe("needs_reindex");
  expect(
    await service.knowledge.retrieve("leave", [ready.repo_id]),
  ).toHaveLength(0);
});

it("repository-only answers abstain without hits, stale indexes, or verified evidence", async () => {
  await configure();
  const rid = await repo();
  let calls = 0;
  handler = async (url, body) => {
    calls++;
    return mockRequest(url, body);
  };
  const empty = await mutate("post", "/api/chat", {
    message: "leave",
    repository_id: rid,
  });
  expect(empty.body.content).toContain(
    "couldn't find relevant information in HR",
  );
  expect(calls).toBe(0);
  const id = await addDoc(rid);
  const unrelated = await mutate("post", "/api/chat", {
    message: "quantum galaxies",
    repository_id: rid,
  });
  expect(unrelated.body.sources).toEqual([]);
  expect(calls).toBe(0);
  handler = async (_url, body: any) => {
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toContain("Do not use general knowledge");
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              answerable: true,
              answer: "Made up policy [99]",
              evidence: [{ source: 1, quote: "This quote is invented" }],
            }),
          },
        },
      ],
    };
  };
  const refused = await mutate("post", "/api/chat", {
    message: "annual leave",
    repository_id: rid,
    use_decision: true,
  });
  expect(refused.body.content).toContain("model did not cite them correctly");
  expect(refused.body.sources).toEqual([]);
  handler = mockRequest;
  const grounded = await mutate("post", "/api/chat", {
    message: "annual leave",
    repository_id: rid,
  });
  expect(grounded.body.sources).toHaveLength(1);
  expect(grounded.body.content).toContain("[1]");
  service.db.run("UPDATE documents SET status='needs_reindex' WHERE id=?", id);
  const stale = await mutate("post", "/api/chat", {
    message: "leave",
    repository_id: rid,
  });
  expect(stale.body.content).toContain("not fully ready");
  expect(stale.body.sources).toEqual([]);
});
it("strict vector retrieval drops unrelated sections below its cosine threshold", async () => {
  await configure();
  const rid = await repo();
  await addDoc(rid);
  await mutate("put", "/api/admin/embeddings", {
    enabled: true,
    base_url: "http://embed.test/v1",
    model: "embed",
    dimensions: 3,
  });
  await mutate(
    "post",
    "/api/admin/documents/" + service.knowledge.documents()[0].id + "/reindex",
  );
  const response = await mutate("post", "/api/chat", {
    message: "travel manager",
    repository_id: rid,
  });
  expect(response.body.content).toContain("couldn't find relevant information");
  expect(response.body.sources).toEqual([]);
});

it("indexes large documents in batches below TEI's four-permit capacity", async () => {
  const rid = await repo();
  await mutate("put", "/api/admin/embeddings", {
    enabled: true,
    base_url: "http://embed.test/v1",
    model: "embed",
    dimensions: 3,
  });
  const sizes: number[] = [];
  handler = async (url, body: any) => {
    if (url.endsWith("/embeddings")) {
      sizes.push(body.input.length);
      if (body.input.length > 16)
        throw new Error("Engine permit capacity exceeded");
    }
    return mockRequest(url, body);
  };
  const uploaded = await mutate("post", "/api/admin/documents", {
    repository_id: rid,
    title: "Large manual",
    content: "Annual leave allowance is 25 days. ".repeat(2000),
  });
  expect(uploaded.status).toBe(201);
  expect(sizes.length).toBeGreaterThan(1);
  expect(Math.max(...sizes)).toBe(2);
  const doc = service.knowledge.documents()[0];
  expect(doc.status).toBe("ready");
  expect(doc.index_completed).toBe(doc.index_total);
  expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(doc.index_total);
});

it("retries a busy embedding batch without duplicating vectors and bounds retries", async () => {
  const settings = {
    embedding_url: "http://embed.test/v1",
    embedding_model: "embed",
    embedding_dimensions: 3,
    embedding_key: "",
  };
  const keys = new Secrets(root, "development");
  let calls = 0;
  const progress: number[] = [];
  const result = await embeddings(
    settings,
    keys,
    ["leave", "travel"],
    async (url, body) => {
      calls++;
      if (calls < 3) throw new InferenceHTTPError(429, 0);
      return mockRequest(url, body);
    },
    (count) => progress.push(count),
  );
  expect(calls).toBe(3);
  expect(result).toHaveLength(2);
  expect(progress).toEqual([2]);
  calls = 0;
  await expect(
    embeddings(settings, keys, ["leave"], async () => {
      calls++;
      throw new InferenceHTTPError(429, 0);
    }),
  ).rejects.toThrow("HTTP 429");
  expect(calls).toBe(4);
  calls = 0;
  await expect(
    embeddings(settings, keys, ["leave"], async () => {
      calls++;
      throw new InferenceHTTPError(400);
    }),
  ).rejects.toThrow("HTTP 400");
  expect(calls).toBe(1);
});

it("recognizes Aigate's minute rate limit without exposing its response body", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: { message: "Request limit exceeded; retry in one minute." },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
  );
  try {
    await requestJSON("http://gateway.test/v1/embeddings", {}, "test-key");
    throw new Error("Expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(InferenceHTTPError);
    expect((error as InferenceHTTPError).retryAfterMs).toBe(61000);
    expect((error as Error).message).toBe(
      "Inference endpoint returned HTTP 429.",
    );
  }
});

it("accepts fenced grounded JSON and whitespace differences, and summarizes repository excerpts", async () => {
  await configure();
  const rid = await repo();
  await addDoc(rid);
  handler = async () => ({
    choices: [
      {
        message: {
          content:
            "```json\n" +
            JSON.stringify({
              answerable: true,
              answer: "Annual leave is 25 days [1].",
              evidence: [
                { source: 1, quote: "Annual   leave allowance is 25 days." },
              ],
            }) +
            "\n```",
        },
      },
    ],
  });
  const answer = await mutate("post", "/api/chat", {
    message: "leave",
    repository_id: rid,
  });
  expect(answer.body.content).toBe("Annual leave is 25 days [1].");
  expect(answer.body.sources).toHaveLength(1);
  const overview = await mutate("post", "/api/chat", {
    message: "summarize the manuals",
    repository_id: rid,
  });
  expect(overview.body.content).toContain(
    "Overview based on selected excerpts",
  );
  expect(overview.body.sources).toHaveLength(1);
  handler = async () => ({
    choices: [{ message: { content: JSON.stringify({ answerable: false }) } }],
  });
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "leave",
        repository_id: rid,
      })
    ).body.content,
  ).toContain("couldn't find relevant information");
});

it("general chat does not search shared repositories unless one is selected", async () => {
  await configure();
  const rid = await repo();
  await addDoc(rid);
  const search = vi.spyOn(service.knowledge, "retrieve");
  let prompt = "";
  handler = async (_url, body: any) => {
    prompt = body.messages[0].content;
    return { choices: [{ message: { content: "General model answer." } }] };
  };
  const general = await mutate("post", "/api/chat", {
    message: "annual leave",
  });
  expect(general.body.content).toBe("General model answer.");
  expect(general.body.sources).toEqual([]);
  expect(prompt).not.toContain("Annual leave allowance is 25 days.");
  expect(search).not.toHaveBeenCalled();
  handler = async (_url, body: any) => {
    expect(body.messages[0].content).toContain("Do not return JSON");
    return {
      choices: [
        {
          message: {
            content: "The manual allows 25 days of annual leave [1].",
          },
        },
      ],
    };
  };
  const grounded = await mutate("post", "/api/chat", {
    message: "annual leave",
    repository_id: rid,
  });
  expect(grounded.body.content).toBe(
    "The manual allows 25 days of annual leave [1].",
  );
  expect(grounded.body.sources).toHaveLength(1);
  handler = async () => ({
    choices: [{ message: { content: "NO_EVIDENCE" } }],
  });
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "annual leave",
        repository_id: rid,
      })
    ).body.content,
  ).toContain("couldn't find relevant information");
});

it("targets routing by user and reports actual usage with administrator access only", async () => {
  await configure();
  const router = await addProvider(
    "Router",
    "openai-compatible",
    ["router-model"],
    "decision",
  );
  const employee = await user();
  await mutate("put", "/api/admin/routing", {
    enabled: true,
    audience: "selected",
    user_ids: ["employee"],
    provider_id: router,
    model: "router-model",
    threshold: 0.8,
  });
  handler = async (url) =>
    url.includes("router.test")
      ? {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answers: {
                    ...decisionReply("direct", "m0").answers,
                    target: {
                      type: "choice",
                      choice: "m0",
                      confidence: 0.95,
                      probabilities: { m0: 1 },
                    },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }
      : {
          choices: [{ message: { content: "Answer" } }],
          usage: { prompt_tokens: 20, completion_tokens: 5 },
        };
  expect((await admin.get("/api/workspace")).body.routing_enabled).toBe(false);
  await mutate("post", "/api/chat", {
    message: "Admin question",
    use_decision: true,
  });
  const response = await request(service.app)
    .post("/api/chat")
    .set("Cookie", employee.cookie)
    .set("X-CSRF-Token", employee.csrf)
    .send({ message: "Employee question", use_decision: false });
  expect(response.status).toBe(200);
  const report = (await admin.get("/api/admin/usage")).body;
  expect(report.totals).toMatchObject({
    questions: 2,
    answered_requests: 2,
    input_tokens: 50,
    output_tokens: 12,
    model_calls: 3,
    reported_calls: 3,
    decision_calls: 1,
  });
  expect(report.users.find((u: any) => u.user_id === "employee")).toMatchObject(
    { questions: 1, input_tokens: 30, output_tokens: 7 },
  );
  expect(
    (
      await request(service.app)
        .get("/api/admin/usage")
        .set("Cookie", employee.cookie)
    ).status,
  ).toBe(403);
  handler = async () => ({
    choices: [{ message: { content: "Unknown usage" } }],
  });
  await mutate("post", "/api/chat", { message: "No token metadata" });
  const missing = (await admin.get("/api/admin/usage")).body;
  expect(missing.totals).toMatchObject({
    questions: 3,
    input_tokens: 50,
    output_tokens: 12,
    model_calls: 4,
    reported_calls: 3,
  });
  service.db.run(
    "UPDATE usage_questions SET created_at=?",
    "2000-01-01T00:00:00.000Z",
  );
  expect(
    (await admin.get("/api/admin/usage?days=7")).body.totals.questions,
  ).toBe(0);
});

it("records failed inference without inventing token usage", async () => {
  await configure();
  handler = async () => {
    throw new Error("Provider unavailable");
  };
  expect(
    (await mutate("post", "/api/chat", { message: "A question" })).status,
  ).toBe(502);
  expect((await admin.get("/api/admin/usage")).body.totals).toMatchObject({
    questions: 1,
    failed_requests: 1,
    model_calls: 1,
    reported_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
  });
});

it("restricts manual backups and schedule changes to administrators", async () => {
  const employee = await user();
  expect(
    (
      await request(service.app)
        .get("/api/admin/backups")
        .set("Cookie", employee.cookie)
    ).status,
  ).toBe(403);
  expect(
    (
      await request(service.app)
        .post("/api/admin/backups")
        .set("Cookie", employee.cookie)
        .set("X-CSRF-Token", employee.csrf)
    ).status,
  ).toBe(403);
  expect((await admin.post("/api/admin/backups")).status).toBe(403);
  expect(
    (
      await mutate("put", "/api/admin/backups/schedule", {
        enabled: true,
        time: "02:00",
      })
    ).status,
  ).toBe(400);
  expect((await mutate("post", "/api/admin/backups")).status).toBe(202);
  await service.backups.idle();
  expect((await admin.get("/api/admin/backups")).body.runs[0].status).toBe(
    "complete",
  );
});

it("lets permitted users browse knowledge documents while hiding other repositories and storage details", async () => {
  const permitted = await repo(["finance"]),
    denied = await repo(["hr"]);
  const doc = await addDoc(permitted);
  await addDoc(denied);
  service.db.run(
    "UPDATE documents SET title=?,error=?,object_ref=? WHERE id=?",
    "Leave 100% policy",
    "secret-upstream-error",
    '{"key":"private-bucket-key"}',
    doc,
  );
  const employee = await user("library-user", ["finance"]);
  const get = (path: string) =>
    request(service.app).get(path).set("Cookie", employee.cookie);
  const list = await get("/api/library");
  expect(list.status).toBe(200);
  expect(list.body.map((r: any) => r.id)).toEqual([permitted]);
  expect((await get("/api/library/" + denied)).status).toBe(404);
  const detail = await get("/api/library/" + permitted + "?search=100%25");
  expect(detail.status).toBe(200);
  expect(detail.body.matching).toBe(1);
  expect(detail.body.documents[0]).toMatchObject({
    title: "Leave 100% policy",
    status: "ready",
    preview: "Annual leave allowance is 25 days.",
  });
  expect(JSON.stringify(detail.body)).not.toContain("secret-upstream-error");
  expect(JSON.stringify(detail.body)).not.toContain("private-bucket-key");
  expect((await request(service.app).get("/api/library")).status).toBe(401);
  service.db.run(
    "UPDATE repositories SET groups_json=? WHERE id=?",
    '["hr"]',
    permitted,
  );
  expect((await get("/api/library/" + permitted)).status).toBe(404);
});
it("paginates library documents and reports stale readiness", async () => {
  const id = await repo();
  for (let n = 0; n < 51; n++)
    service.db.run(
      "INSERT INTO documents(repo_id,title,content,status) VALUES(?,?,?,?)",
      id,
      "Manual " + n,
      "x".repeat(900),
      n === 0 ? "needs_reindex" : "ready",
    );
  const first = (await admin.get("/api/library/" + id)).body;
  expect(first.repository).toMatchObject({ documents: 51, ready: 50 });
  expect(first.documents).toHaveLength(50);
  expect(first.documents[0].preview).toHaveLength(600);
  expect(first.pages).toBe(2);
  expect(
    (await admin.get("/api/library/" + id + "?page=2")).body.documents,
  ).toHaveLength(1);
});
it("retains chat paths and permits folders only within the same path", async () => {
  const rid = await repo();
  const knowledgeFolder = (
    await mutate("post", "/api/chat-groups", {
      name: "Manual questions",
      repository_id: rid,
    })
  ).body.id;
  const generalFolder = (
    await mutate("post", "/api/chat-groups", { name: "Work" })
  ).body.id;
  const first = await mutate("post", "/api/chat", {
    message: "Path question",
    repository_id: rid,
    group_id: knowledgeFolder,
  });
  expect(first.status).toBe(200);
  const cid = first.body.conversation_id;
  const saved = (await admin.get("/api/workspace")).body;
  expect(saved.conversations.find((c: any) => c.id === cid)).toMatchObject({
    repository_id: rid,
    group_id: knowledgeFolder,
  });
  expect(
    saved.groups.find((g: any) => g.id === knowledgeFolder).repository_id,
  ).toBe(rid);
  expect(
    (
      await mutate("patch", "/api/conversations/" + cid, {
        group_id: generalFolder,
      })
    ).status,
  ).toBe(400);
  expect(
    (await mutate("patch", "/api/conversations/" + cid, { group_id: null }))
      .status,
  ).toBe(200);
  expect(
    (
      await mutate("patch", "/api/conversations/" + cid, {
        group_id: knowledgeFolder,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "Wrong folder",
        group_id: knowledgeFolder,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await mutate("post", "/api/chat", {
        message: "Follow up",
        conversation_id: cid,
        repository_id: null,
      })
    ).status,
  ).toBe(200);
  expect(
    (await admin.get("/api/workspace")).body.conversations.find(
      (c: any) => c.id === cid,
    ).repository_id,
  ).toBe(rid);
  await mutate("delete", "/api/chat-groups/" + knowledgeFolder);
  expect(
    (await admin.get("/api/workspace")).body.conversations.find(
      (c: any) => c.id === cid,
    ),
  ).toMatchObject({ repository_id: rid, group_id: null });
});
