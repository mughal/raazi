import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { LocalDB, Failure } from "./db.js";
import { ObjectStorage, ObjectRef } from "./storage.js";
const exec = promisify(execFile);
export type DumpDatabase = (url: string, path: string) => Promise<void>;
export const dumpDatabase: DumpDatabase = async (connection, path) => {
  const url = new URL(connection);
  const password = decodeURIComponent(url.password);
  url.password = "";
  try {
    await exec(
      "pg_dump",
      [
        "--dbname",
        url.toString(),
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--file",
        path,
      ],
      {
        env: { ...process.env, PGPASSWORD: password },
        timeout: 1800000,
        maxBuffer: 1024 * 1024,
      },
    );
    await exec("pg_restore", ["--list", path], {
      timeout: 60000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      "PostgreSQL backup failed. Check PostgreSQL 17 backup tools, connection, and database access.",
    );
  }
};
export function nextDaily(time: string, now = new Date()) {
  const [hour, minute] = time.split(":").map(Number);
  const next = new Date(now);
  next.setUTCHours((hour + 19) % 24, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
export class Backups {
  busy = false;
  stage = "";
  mutations = 0;
  private task?: Promise<void>;
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private db: LocalDB,
    private storage: ObjectStorage,
    private urls: string[],
    private snapshotLock: <T>(fn: () => Promise<T>) => Promise<T>,
    private dump: DumpDatabase = dumpDatabase,
  ) {
    db.raw
      .exec(`CREATE TABLE IF NOT EXISTS backup_runs(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,status TEXT NOT NULL,trigger TEXT NOT NULL,refs TEXT NOT NULL DEFAULT '[]',error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS backup_schedule(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,time TEXT NOT NULL DEFAULT '02:00',next_run TEXT,last_success_id TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO backup_schedule(id) VALUES(1);`);
    if (
      !db
        .all("PRAGMA table_info(backup_schedule)")
        .some((c) => c.name === "last_success_id")
    ) {
      db.raw.exec(
        "ALTER TABLE backup_schedule ADD COLUMN last_success_id TEXT NOT NULL DEFAULT ''",
      );
      db.run(
        "UPDATE backup_schedule SET last_success_id=COALESCE((SELECT id FROM backup_runs WHERE status='complete' ORDER BY created_at DESC LIMIT 1),'') WHERE id=1",
      );
    }
    db.run(
      "UPDATE backup_runs SET status='failed',error='Backup interrupted by app restart. Retry the backup.' WHERE status='running'",
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, 30000);
    this.timer.unref();
  }
  report() {
    return {
      busy: this.busy,
      stage: this.stage,
      storage_ready: this.storage.enabled(),
      postgres_databases: this.urls.length,
      schedule: this.db.get("SELECT * FROM backup_schedule WHERE id=1")!,
      runs: this.db
        .all(
          "SELECT id,created_at,status,trigger,error,refs FROM backup_runs ORDER BY created_at DESC LIMIT 30",
        )
        .map((r) => ({
          id: String(r.id),
          created_at: String(r.created_at),
          status: String(r.status),
          trigger: String(r.trigger),
          error: String(r.error),
          files: JSON.parse(r.refs).map((f: ObjectRef) => ({
            key: f.key,
            size: f.size,
            sha256: f.sha256,
          })),
        })),
    };
  }
  schedule(enabled: boolean, time: string) {
    const settings = this.db.get("SELECT * FROM backup_schedule WHERE id=1")!;
    if (enabled && !settings.last_success_id)
      throw new Failure(
        400,
        "Create a successful manual backup before enabling daily backups.",
      );
    if (enabled && !this.storage.enabled())
      throw new Failure(400, "Configure object storage first.");
    this.db.run(
      "UPDATE backup_schedule SET enabled=?,time=?,next_run=? WHERE id=1",
      Number(enabled),
      time,
      enabled ? nextDaily(time) : null,
    );
  }
  start(trigger = "manual") {
    if (this.busy) throw new Failure(409, "A backup is already running.");
    if (!this.storage.enabled())
      throw new Failure(
        400,
        "Configure object storage before creating a backup.",
      );
    this.busy = true;
    this.stage = "Waiting for current changes";
    const id =
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomBytes(4).toString("hex");
    this.db.run(
      "INSERT INTO backup_runs(id,created_at,status,trigger) VALUES(?,?,'running',?)",
      id,
      new Date().toISOString(),
      trigger,
    );
    this.task = this.run(id).finally(() => {
      this.busy = false;
      this.stage = "";
    });
    return id;
  }
  async idle() {
    await this.task;
  }
  async tick(now = new Date()) {
    const settings = this.db.get("SELECT * FROM backup_schedule WHERE id=1")!;
    if (
      !this.busy &&
      settings.enabled &&
      settings.next_run <= now.toISOString()
    ) {
      this.db.run(
        "UPDATE backup_schedule SET next_run=? WHERE id=1",
        nextDaily(settings.time, now),
      );
      try {
        this.start("daily");
      } catch {
        this.db.run(
          "INSERT INTO backup_runs(id,created_at,status,trigger,error) VALUES(?,?,'failed','daily','Object storage is unavailable. Configure storage and retry.')",
          randomBytes(16).toString("hex"),
          now.toISOString(),
        );
      }
    }
  }
  private async run(id: string) {
    let directory: string | undefined;
    const refs: ObjectRef[] = [];
    try {
      await this.cleanupFailed();
      directory = await mkdtemp(join(tmpdir(), "raazi-backup-"));
      const deadline = Date.now() + 60000;
      while (this.mutations) {
        if (Date.now() > deadline)
          throw new Error(
            "Current changes did not finish. Retry when uploads and chats have completed.",
          );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const files = await this.snapshotLock(async () => {
        this.stage = "Backing up SQLite";
        const sqlite = join(directory!, "raazi.sqlite");
        await this.db.raw.backup(sqlite);
        const check = new Database(sqlite, { readonly: true });
        try {
          if (check.pragma("integrity_check", { simple: true }) !== "ok")
            throw new Error("SQLite integrity check failed.");
        } finally {
          check.close();
        }
        await writeFile(
          join(directory!, "file-catalogue.json"),
          JSON.stringify(this.storage.catalogue(), null, 2),
        );
        const files = ["raazi.sqlite", "file-catalogue.json"];
        for (let n = 0; n < this.urls.length; n++) {
          this.stage = "Backing up PostgreSQL";
          const name = "postgres-" + (n + 1) + ".dump";
          await this.dump(this.urls[n], join(directory!, name));
          if (!(await stat(join(directory!, name))).size)
            throw new Error("PostgreSQL backup is empty.");
          files.push(name);
        }
        return files;
      });
      this.stage = "Uploading backup to storage";
      for (const name of files) {
        refs.push(
          await this.storage.putBackup(join(directory, name), id, name),
        );
        this.db.run(
          "UPDATE backup_runs SET refs=? WHERE id=?",
          JSON.stringify(refs),
          id,
        );
      }
      const manifest = {
        format: 1,
        id,
        created_at: new Date().toISOString(),
        files: refs,
        databases: this.urls.map((url, n) => ({
          file: "postgres-" + (n + 1) + ".dump",
          database: new URL(url).pathname.slice(1),
        })),
        restore:
          "Restore into an isolated instance first. Preserve ENCRYPTION_KEY, SECRET_KEY and all original bucket objects separately. SQLite and PostgreSQL snapshots were taken sequentially while app changes were paused. PostgreSQL dumps include the entire configured database. Use PostgreSQL 17 pg_restore.",
      };
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
      refs.push(
        await this.storage.putBackup(
          join(directory, "manifest.json"),
          id,
          "manifest.json",
        ),
      );
      this.db.run(
        "UPDATE backup_runs SET status='complete',refs=? WHERE id=?",
        JSON.stringify(refs),
        id,
      );
      this.db.run(
        "UPDATE backup_schedule SET last_success_id=? WHERE id=1",
        id,
      );
      this.stage = "Keeping the latest seven backups";
      await this.prune();
    } catch (error) {
      const message =
        error instanceof Error &&
        /^(PostgreSQL backup failed|PostgreSQL backup is empty|SQLite integrity|Current changes)/.test(
          error.message,
        )
          ? error.message
          : "Backup failed. Check storage access, available disk space, and backup tools. Retry later.";
      this.db.run(
        "UPDATE backup_runs SET status='failed',error=?,refs=? WHERE id=?",
        message,
        JSON.stringify(refs),
        id,
      );
      await this.cleanupFailed();
    } finally {
      if (directory)
        await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
  private async cleanupFailed() {
    for (const run of this.db.all(
      "SELECT id,refs FROM backup_runs WHERE status='failed' AND refs!='[]'",
    )) {
      const remaining: ObjectRef[] = [];
      for (const ref of JSON.parse(run.refs)) {
        try {
          await this.storage.delete(ref);
        } catch {
          remaining.push(ref);
        }
      }
      this.db.run(
        "UPDATE backup_runs SET refs=? WHERE id=?",
        JSON.stringify(remaining),
        run.id,
      );
    }
  }
  private async prune() {
    const old = this.db
      .all(
        "SELECT * FROM backup_runs WHERE status IN ('complete','cleanup_pending') ORDER BY created_at DESC",
      )
      .slice(7);
    for (const run of old) {
      try {
        for (const ref of JSON.parse(run.refs)) await this.storage.delete(ref);
        this.db.run(
          "UPDATE backup_runs SET status='removed',refs='[]',error='' WHERE id=?",
          run.id,
        );
      } catch {
        this.db.run(
          "UPDATE backup_runs SET status='cleanup_pending',error='Retention cleanup failed. Older objects may remain; cleanup retries after the next backup.' WHERE id=?",
          run.id,
        );
      }
    }
  }
  async close() {
    clearInterval(this.timer);
    await this.idle();
  }
}
