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
  request: async (url, body) => {
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
const server = service.app.listen(8091, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(async () => {
      await service.close();
      if (resolve(root).startsWith(resolve(tmpdir()) + sep))
        rmSync(root, { recursive: true, force: true });
      process.exit(0);
    }),
  );
