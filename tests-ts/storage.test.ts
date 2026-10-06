import { beforeEach, afterEach, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../server/app";
import { memoryStorage, storageInput } from "./storage-fixture";
import { s3Factory } from "../server/storage";
let root: string,
  service: Awaited<ReturnType<typeof createApp>>,
  store: ReturnType<typeof memoryStorage>,
  admin: ReturnType<typeof request.agent>,
  csrf: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "raazi-storage-test-"));
  store = memoryStorage();
  service = await createApp({
    database: join(root, "test.db"),
    secret: "storage-secret-with-at-least-32-characters",
    mode: "development",
    secure: false,
    adminGroup: "admins",
    objectFactory: store.factory,
  });
  admin = request.agent(service.app);
  let r = await admin.get("/api/session");
  await admin.post("/auth/development").set("X-CSRF-Token", r.body.csrf);
  r = await admin.get("/api/session");
  csrf = r.body.csrf;
});
afterEach(async () => {
  await service.close();
  const path = resolve(root);
  if (
    !path.startsWith(resolve(tmpdir()) + sep) ||
    !path.includes("raazi-storage-test-")
  )
    throw new Error("Unsafe cleanup");
  rmSync(path, { recursive: true, force: true });
});
it("tests unsaved settings, cleans the probe, protects admin actions, and encrypts both keys", async () => {
  expect((await request(service.app).get("/api/admin/storage")).status).toBe(
    401,
  );
  expect(
    (await admin.post("/api/admin/storage/test").send(storageInput)).status,
  ).toBe(403);
  const response = await admin
    .post("/api/admin/storage/test")
    .set("X-CSRF-Token", csrf)
    .send(storageInput);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    accessible: true,
    writable: true,
    readable: true,
    cleanup: true,
  });
  expect(store.events.map((e) => e.method)).toEqual([
    "head",
    "put",
    "get",
    "delete",
  ]);
  expect(store.objects.size).toBe(0);
  expect(service.storage.enabled()).toBe(false);
  await admin
    .put("/api/admin/storage")
    .set("X-CSRF-Token", csrf)
    .send(storageInput);
  const publicSettings = (await admin.get("/api/admin/storage")).body;
  expect(publicSettings.has_secret_key).toBe(true);
  expect(JSON.stringify(publicSettings)).not.toContain(storageInput.secret_key);
  const row = service.db.get("SELECT * FROM object_stores")!;
  expect(row.secret_key).not.toBe(storageInput.secret_key);
  expect(row.access_key).not.toBe(storageInput.access_key);
  expect(service.secrets.open(row.secret_key)).toBe(storageInput.secret_key);
});
it("reports each bucket failure and tries cleanup without saving a failed candidate", async () => {
  for (const method of ["head", "put", "get", "delete"] as const) {
    service.storage.factory = (s) => {
      const client = store.factory(s);
      return {
        ...client,
        [method]: async () => {
          throw new Error("secret response " + storageInput.secret_key);
        },
      };
    };
    const result = await admin
      .put("/api/admin/storage")
      .set("X-CSRF-Token", csrf)
      .send(storageInput);
    expect(result.status).toBe(502);
    expect(result.body.error).not.toContain(storageInput.secret_key);
    expect(service.storage.enabled()).toBe(false);
    if (method === "delete")
      expect(result.body.error).toMatch(/Remove this object/);
    else expect(result.body.error).toMatch(/Bucket test failed/);
  }
  service.storage.factory = store.factory;
});
it("preserves the old bucket for existing originals and verifies integrity and version references", async () => {
  await service.storage.save(storageInput);
  const raw = Buffer.from("original bytes"),
    ref = await service.storage.put(raw, "text/plain", "uploads");
  await service.storage.save({
    ...storageInput,
    bucket: "another-bucket",
    access_key: "",
    secret_key: "",
  });
  expect(await service.storage.get(ref)).toEqual(raw);
  await service.storage.save({ ...storageInput, enabled: false });
  await expect(
    service.storage.put(raw, "text/plain", "uploads"),
  ).rejects.toThrow(/Uploads are not available/);
  expect(await service.storage.get(ref)).toEqual(raw);
  await expect(
    service.storage.save({
      ...storageInput,
      endpoint: "https://new-endpoint.test",
      access_key: "",
      secret_key: "",
    }),
  ).rejects.toThrow(/new endpoint requires new keys/);
  const key = [...store.objects.keys()].find((k) => k.endsWith(ref.key))!;
  store.objects.set(key, Buffer.from("corruption"));
  await expect(service.storage.get(ref)).rejects.toThrow(
    /Cannot read the original/,
  );
  await service.storage.delete(ref);
  expect(store.events.at(-1)?.version).toBe("test-version");
});
it("uses the real AWS SDK against an HTTP S3 fixture with signed HEAD, PUT, GET, and DELETE", async () => {
  const objects = new Map<string, Buffer>(),
    seen: {
      method: string;
      path: string;
      auth?: string;
      md5?: string;
      sha?: string;
    }[] = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(Buffer.from(part));
      const body = Buffer.concat(parts);
      seen.push({
        method: req.method!,
        path: url.pathname,
        auth: req.headers.authorization,
        md5: req.headers["content-md5"] as string,
        sha: req.headers["x-amz-content-sha256"] as string,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      if (req.method === "PUT") {
        if (
          req.headers["content-md5"] !==
          createHash("md5").update(body).digest("base64")
        ) {
          res.writeHead(400).end();
          return;
        }
        objects.set(url.pathname, body);
        res.setHeader("x-amz-version-id", "fixture-v1");
        res.end();
        return;
      }
      if (req.method === "GET") {
        const bytes = objects.get(url.pathname);
        if (!bytes) {
          res.writeHead(404).end();
          return;
        }
        res.setHeader("content-length", bytes.length);
        res.end(bytes);
        return;
      }
      if (req.method === "DELETE") {
        objects.delete(url.pathname);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(405).end();
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    service.storage.factory = s3Factory;
    await service.storage.save({
      ...storageInput,
      endpoint: "http://127.0.0.1:" + address.port,
    });
    expect(objects.size).toBe(0);
    const bytes = Buffer.from([0, 1, 200, 255]),
      ref = await service.storage.put(
        bytes,
        "application/octet-stream",
        "uploads",
      );
    expect(ref.version_id).toBe("fixture-v1");
    expect(await service.storage.get(ref)).toEqual(bytes);
    await service.storage.delete(ref);
    expect(objects.size).toBe(0);
    expect(seen.every((r) => r.auth?.startsWith("AWS4-HMAC-SHA256"))).toBe(
      true,
    );
    expect(seen.map((r) => r.method)).toEqual([
      "HEAD",
      "PUT",
      "GET",
      "DELETE",
      "PUT",
      "GET",
      "DELETE",
    ]);
    expect(
      seen
        .filter((r) => r.method === "PUT")
        .every((r) => r.sha !== "STREAMING-UNSIGNED-PAYLOAD-TRAILER"),
    ).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

it("reports safe bucket access diagnostics without revealing upstream secrets", async () => {
  const cases = [
    [{ cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } }, "TLS certificate chain"],
    [{ code: "ENOTFOUND" }, "cannot resolve"],
    [{ name: "SignatureDoesNotMatch" }, "signature was rejected"],
    [{ $metadata: { httpStatusCode: 403 } }, "HTTP 403"],
    [{ message: "secret-do-not-expose" }, "certificate trust"],
  ] as const;
  for (const [failure, text] of cases) {
    service.storage.factory = () => ({
      ...store.factory(storageInput),
      head: async () => {
        throw { ...failure, message: "secret-do-not-expose" };
      },
    });
    const response = await admin
      .post("/api/admin/storage/test")
      .set("X-CSRF-Token", csrf)
      .send(storageInput);
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).toContain(text);
    expect(JSON.stringify(response.body)).not.toContain("secret-do-not-expose");
  }
});
