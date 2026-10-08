import { beforeEach, afterEach, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { SignJWT } from "jose";
import { Sessions } from "../server/sessions";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { createApp } from "../server/app";
import { memoryStorage, storageInput } from "./storage-fixture";
import { policyPDF, policyDOCX, mockRequest } from "./fixtures";
let root: string,
  service: Awaited<ReturnType<typeof createApp>>,
  admin: ReturnType<typeof request.agent>,
  csrf: string,
  store: ReturnType<typeof memoryStorage>;
let calls: any[], broken: boolean;
const secret = "upload-test-secret-with-at-least-32-characters";
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "raazi-upload-test-"));
  store = memoryStorage();
  calls = [];
  broken = false;
  service = await createApp({
    database: join(root, "test.db"),
    secret,
    mode: "development",
    secure: false,
    adminGroup: "admins",
    objectFactory: store.factory,
    request: async (url, body) => {
      calls.push(body);
      if (broken) throw new Error("provider failure");
      return mockRequest(url, body);
    },
  });
  admin = request.agent(service.app);
  let session = await admin.get("/api/session");
  await admin.post("/auth/development").set("X-CSRF-Token", session.body.csrf);
  session = await admin.get("/api/session");
  csrf = session.body.csrf;
  await admin.put("/api/admin/settings").set("X-CSRF-Token", csrf).send({
    base_url: "http://model.test/v1",
    model: "local",
    system_prompt: "Use the files.",
    supports_images: false,
  });
});
afterEach(async () => {
  await service.close();
  const target = resolve(root);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !target.includes("raazi-upload-test-")
  )
    throw new Error("Unsafe cleanup");
  rmSync(target, { recursive: true, force: true });
});
const upload = (name: string, raw: Buffer) =>
  admin
    .post("/api/attachments")
    .set("X-CSRF-Token", csrf)
    .attach("file", raw, name);
const chat = (ids: string[], conversation_id?: number) =>
  admin.post("/api/chat").set("X-CSRF-Token", csrf).send({
    message: "Travel expenses manager approval",
    attachment_ids: ids,
    conversation_id,
  });
async function stranger() {
  service.db.run(
    "INSERT INTO users(id,name,email,role,groups_json) VALUES('stranger','Stranger','stranger@test','user','[]')",
  );
  const token = await new SignJWT({
    uid: "stranger",
    csrf: "stranger-csrf",
    sid: new Sessions(service.db).create("stranger"),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("raazi")
    .setAudience("raazi-session")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
  return "raazi_session=" + token;
}
it("requires S3, rejects unknown formats, and keeps unreadable originals with a clear status", async () => {
  expect((await upload("policy.pdf", await policyPDF())).status).toBe(400);
  await service.storage.save(storageInput);
  expect(
    (await upload("unknown.xlsx", Buffer.from("unknown"))).body.error,
  ).toMatch(/not supported yet/);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const original = Buffer.from(await pdf.save()),
    result = await upload("scan.pdf", original);
  expect(result.status).toBe(201);
  expect(result.body.status).toBe("unsupported");
  expect(result.body.error).toMatch(/OCR|readable text/i);
  expect((await chat([result.body.id])).status).toBe(400);
  expect(
    await service.attachments.original(
      service.db.get("SELECT id FROM users WHERE role='admin'")!.id,
      result.body.id,
    ),
  ).toEqual(original);
  expect(store.objects.size).toBe(2);
});
it("indexes private PDFs and DOCX, serves original bytes, enforces ownership, and keeps page citations", async () => {
  await service.storage.save(storageInput);
  const pdf = await policyPDF(),
    file = (await upload("private.pdf", pdf)).body;
  expect(file.status).toBe("ready");
  expect(file.search_mode).toBe("keyword");
  expect(file.object_ref).toBeUndefined();
  const response = await chat([file.id]);
  expect(response.status).toBe(200);
  const source = response.body.sources[0];
  expect(source.page).toBe(2);
  expect(source.attachment_id).toBe(file.id);
  const view = await admin.get("/api/sources/" + source.source_id);
  expect(view.body.file_url).toMatch(/#page=2$/);
  expect(view.body.object_ref).toBeUndefined();
  const actual = await admin.get(file.file_url);
  expect(actual.body).toEqual(pdf);
  const cookie = await stranger();
  for (const path of [
    file.file_url,
    "/api/sources/" + source.source_id,
    "/api/sources/" + source.source_id + "/file",
  ])
    expect(
      (await request(service.app).get(path).set("Cookie", cookie)).status,
    ).toBe(404);
  expect(
    (
      await request(service.app)
        .post("/api/chat")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", "stranger-csrf")
        .send({ message: "Tell me", attachment_ids: [file.id] })
    ).status,
  ).toBe(404);
  expect(
    (await request(service.app).get("/api/attachments").set("Cookie", cookie))
      .body,
  ).toEqual([]);
  const doc = (await upload("policy.docx", policyDOCX())).body;
  expect(doc.status).toBe("ready");
  expect(
    service.db.get(
      "SELECT count(*) AS n FROM attachment_passages WHERE attachment_id=?",
      doc.id,
    )!.n,
  ).toBeGreaterThan(0);
  expect(
    service.db.get("SELECT units FROM attachments WHERE id=?", file.id)!.units,
  ).toContain("Travel expenses");
  const history = await admin.get(
    "/api/conversations/" + response.body.conversation_id,
  );
  expect(JSON.stringify(history.body)).toContain(file.id);
  await admin.delete("/api/attachments/" + file.id).set("X-CSRF-Token", csrf);
  expect((await admin.get("/api/sources/" + source.source_id)).status).toBe(
    404,
  );
  expect(
    (await admin.get("/api/conversations/" + response.body.conversation_id))
      .status,
  ).toBe(200);
  expect(
    service.db.get(
      "SELECT count(*) AS n FROM attachment_passages WHERE attachment_id=?",
      file.id,
    )!.n,
  ).toBe(0);
});
it("uses embeddings, marks changed vectors stale, and retries without uploading the original again", async () => {
  await service.storage.save(storageInput);
  const embedding = {
    enabled: true,
    base_url: "http://model.test/v1",
    model: "embed",
    dimensions: 3,
  };
  expect(
    (
      await admin
        .put("/api/admin/embeddings")
        .set("X-CSRF-Token", csrf)
        .send(embedding)
    ).status,
  ).toBe(200);
  const file = (await upload("vector.pdf", await policyPDF())).body;
  expect(file.search_mode).toBe("vector");
  expect((await chat([file.id])).status).toBe(200);
  expect(
    service.db.get(
      "SELECT vector FROM attachment_passages WHERE attachment_id=? LIMIT 1",
      file.id,
    )!.vector,
  ).toBeTruthy();
  await admin
    .put("/api/admin/embeddings")
    .set("X-CSRF-Token", csrf)
    .send({ ...embedding, model: "embed-new" });
  expect((await chat([file.id])).status).toBe(400);
  const count = store.events.filter(
    (e) => e.method === "put" && e.key?.includes("/uploads/"),
  ).length;
  broken = true;
  expect(
    (
      await admin
        .post("/api/attachments/" + file.id + "/reindex")
        .set("X-CSRF-Token", csrf)
    ).status,
  ).toBeGreaterThanOrEqual(400);
  expect((await admin.get("/api/attachments")).body[0].status).toBe("failed");
  broken = false;
  expect(
    (
      await admin
        .post("/api/attachments/" + file.id + "/reindex")
        .set("X-CSRF-Token", csrf)
    ).body.status,
  ).toBe("ready");
  expect(
    store.events.filter(
      (e) => e.method === "put" && e.key?.includes("/uploads/"),
    ).length,
  ).toBe(count);
  expect((await chat([file.id])).status).toBe(200);
});
it("validates images, sends vision content to the local model, and persists references without base64", async () => {
  await service.storage.save(storageInput);
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "#008888" },
  })
    .png()
    .toBuffer();
  expect((await upload("photo.png", image)).status).toBe(400);
  await admin.put("/api/admin/settings").set("X-CSRF-Token", csrf).send({
    base_url: "http://model.test/v1",
    model: "vision",
    system_prompt: "Read images.",
    supports_images: true,
  });
  expect((await upload("broken.png", Buffer.from("broken"))).status).toBe(400);
  const file = (await upload("photo.png", image)).body;
  expect(file.status).toBe("ready");
  expect(file.warning).toMatch(/indexing is not supported yet/);
  const answer = await chat([file.id]);
  expect(answer.status).toBe(200);
  const content = calls.at(-1).messages.at(-1).content;
  expect(content[1].type).toBe("image_url");
  expect(content[1].image_url.url).toBe(
    "data:image/png;base64," + image.toString("base64"),
  );
  expect((await chat([], answer.body.conversation_id)).status).toBe(200);
  expect(calls.at(-1).messages.at(-1).content[1].type).toBe("image_url");
  expect(
    JSON.stringify(service.db.all("SELECT * FROM messages")),
  ).not.toContain("base64");
  expect(
    (
      await admin
        .post("/api/attachments/" + file.id + "/reindex")
        .set("X-CSRF-Token", csrf)
    ).status,
  ).toBe(400);
  expect(
    store.events.some(
      (e) => e.method === "get" && e.version === "test-version",
    ),
  ).toBe(true);
});
