/** An isolated browser fixture. Never used by the application entry point. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createApp } from "../server/app.js";
import { mockRequest } from "./fixtures.js";
const root = mkdtempSync(join(tmpdir(), "raazi-browser-test-"));
const service = await createApp({
  database: join(root, "raazi.db"),
  secret: "browser-fixture-secret-more-than-32-characters",
  mode: "development",
  secure: false,
  adminGroup: "admins",
  request: mockRequest,
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
