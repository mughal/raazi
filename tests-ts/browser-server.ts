/** An isolated browser fixture. Never used by the application entry point. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createApp } from "../server/app.js";
import { memoryStorage } from "./storage-fixture.js";
import { mockRequest } from "./fixtures.js";
const root = mkdtempSync(join(tmpdir(), "raazi-browser-test-"));
const service = await createApp({
  database: join(root, "raazi.db"),
  secret: "browser-fixture-secret-more-than-32-characters",
  mode: "development",
  secure: false,
  adminGroup: "admins",
  getRequest: async (url) =>
    url.includes("jev.test")
      ? { models: [{ name: "jev-latest" }] }
      : { data: [{ id: "small" }, { id: "expert" }] },
  request: async (url, body) => {
    if (url.endsWith("/systemone")) {
      const keys = Object.keys((body as any).questions.target.criteria),
        selected = keys.at(-1)!;
      return {
        answers: {
          action: {
            type: "choice",
            choice: "knowledge",
            confidence: 0.96,
            probabilities: { direct: 0, knowledge: 1, clarify: 0 },
          },
          target: {
            type: "choice",
            choice: selected,
            confidence: 0.95,
            probabilities: Object.fromEntries(
              keys.map((k) => [k, k === selected ? 1 : 0]),
            ),
          },
        },
      };
    }
    if (
      !url.endsWith("/embeddings") &&
      (body as { messages: { content: unknown }[] }).messages.at(-1)
        ?.content === "Show formatted response"
    )
      return {
        choices: [
          {
            message: {
              content:
                "## Professional answer\n\nA **clear** answer with a citation [1].\n\n- First step\n- Second step\n\n| Item | Value |\n| --- | --- |\n| Result | Ready |\n\n```typescript\nconst answer = 42;\n```\n\n[Unsafe link](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![Remote image](https://image.invalid/private.png)",
            },
          },
        ],
      };
    return mockRequest(url, body);
  },
  objectFactory: memoryStorage().factory,
});
const portalService = await createApp({
  database: join(root, "portal.db"),
  secret: "portal-browser-fixture-secret-more-than-32-characters",
  encryptionKey: Buffer.alloc(32, 1).toString("base64url"),
  mode: "portal",
  secure: false,
  adminGroup: "admins",
  portalURL: "https://portal.example.test/api",
  portalAdmins: ["employee"],
  portalFetch: async (input, init) => {
    const body = JSON.parse(init!.body as string);
    return Response.json({
      executedSuccessfully: String(input).endsWith("validateUserFromLdap")
        ? body.username === "employee" && body.password === "fixture-password"
        : body.employeeNumber === "employee" && body.otp === "123456",
    });
  },
});
const portalServer = portalService.app.listen(8092, "127.0.0.1");
const server = service.app.listen(8091, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(async () => {
      await service.close();
      await new Promise<void>((done) => portalServer.close(() => done()));
      await portalService.close();
      if (resolve(root).startsWith(resolve(tmpdir()) + sep))
        rmSync(root, { recursive: true, force: true });
      process.exit(0);
    }),
  );
