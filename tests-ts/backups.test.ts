import { beforeEach, afterEach, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { LocalDB, Secrets } from "../server/db";
import { ObjectStorage } from "../server/storage";
import { Backups, nextDaily } from "../server/backups";
import { memoryStorage, storageInput } from "./storage-fixture";
let root: string,
  db: LocalDB,
  storage: ObjectStorage,
  backups: Backups,
  memory: ReturnType<typeof memoryStorage>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "raazi-backup-test-"));
  db = new LocalDB(join(root, "workspace.sqlite"));
  db.run(
    "INSERT INTO users(id,name,email,role) VALUES('admin','Administrator','admin@test','admin')",
  );
  memory = memoryStorage();
  storage = new ObjectStorage(
    db,
    new Secrets(root, "development"),
    memory.factory,
  );
  await storage.save(storageInput);
  backups = new Backups(
    db,
    storage,
    ["postgresql://user:secret@host/workspace"],
    (fn) => fn(),
    async (_url, path) => {
      await writeFile(path, "fixture PostgreSQL dump");
    },
  );
});
afterEach(async () => {
  await backups.close();
  db.close();
  await rm(root, { recursive: true, force: true });
});
it("uploads a readable SQLite snapshot, PostgreSQL dump and credential-free manifest", async () => {
  const id = backups.start();
  expect(() => backups.start()).toThrow("already running");
  await backups.idle();
  const run = backups.report().runs[0];
  expect(run.status).toBe("complete");
  expect(run.files).toHaveLength(4);
  expect(
    run.files.every((file: any) => file.key.includes("/backups/" + id + "/")),
  ).toBe(true);
  const sqlite = run.files.find((file: any) =>
    file.key.endsWith("raazi.sqlite"),
  )!;
  const bytes = [...memory.objects.entries()].find(([key]) =>
    key.endsWith(sqlite.key),
  )![1];
  const restored = join(root, "restored.sqlite");
  await writeFile(restored, bytes);
  const check = new Database(restored, { readonly: true });
  try {
    expect(check.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(
      check.prepare("SELECT name FROM users WHERE id='admin'").get(),
    ).toEqual({ name: "Administrator" });
  } finally {
    check.close();
  }
  const manifest = [...memory.objects.entries()]
    .find(([key]) => key.endsWith("manifest.json"))![1]
    .toString();
  expect(manifest).not.toContain("user:secret");
  expect(JSON.parse(manifest).databases[0].database).toBe("workspace");
});
it("requires a successful backup, schedules daily and retains seven complete backups", async () => {
  expect(() => backups.schedule(true, "02:00")).toThrow(
    "successful manual backup",
  );
  const first = backups.start();
  await backups.idle();
  backups.schedule(true, "02:00");
  expect(backups.report().schedule.enabled).toBe(1);
  const due = new Date(backups.report().schedule.next_run);
  await backups.tick(due);
  await backups.idle();
  expect(
    backups.report().runs.some((run: any) => run.trigger === "daily"),
  ).toBe(true);
  for (let n = 0; n < 6; n++) {
    backups.start();
    await backups.idle();
  }
  expect(
    backups.report().runs.filter((run: any) => run.status === "complete"),
  ).toHaveLength(7);
  expect(
    [...memory.objects.keys()].filter((key) => key.includes("/backups/")),
  ).toHaveLength(28);
  expect(
    backups.report().runs.find((run: any) => run.id === first)!.status,
  ).toBe("removed");
});
it("does not replace successful backups when PostgreSQL dumping fails", async () => {
  backups.start();
  await backups.idle();
  await backups.close();
  backups = new Backups(
    db,
    storage,
    ["postgresql://host/workspace"],
    (fn) => fn(),
    async () => {
      throw new Error("password-sensitive upstream error");
    },
  );
  backups.start();
  await backups.idle();
  const report = backups.report();
  expect(
    report.runs.filter((run: any) => run.status === "complete"),
  ).toHaveLength(1);
  const failed = report.runs.find((run: any) => run.status === "failed")!;
  expect(failed.error).not.toContain("password-sensitive");
  expect(failed.files).toHaveLength(0);
});
it("computes future daily times in Asia/Karachi across midnight", () => {
  expect(nextDaily("02:00", new Date("2026-10-07T23:00:00Z"))).toBe(
    "2026-10-08T21:00:00.000Z",
  );
  expect(nextDaily("02:00", new Date("2026-10-07T12:00:00Z"))).toBe(
    "2026-10-07T21:00:00.000Z",
  );
});
