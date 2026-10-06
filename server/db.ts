import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
export type Row = Record<string, any>;
export class Failure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class Secrets {
  private key: Buffer;
  constructor(root: string, mode: string, key?: string) {
    const file = resolve(root, "encryption.key");
    if (!key) {
      if (mode !== "development") throw new Error("ENCRYPTION_KEY is required");
      if (!existsSync(file))
        writeFileSync(file, randomBytes(32).toString("base64url"));
      key = readFileSync(file, "utf8").trim();
    }
    this.key = Buffer.from(key, "base64url");
    if (this.key.length !== 32)
      throw new Error("ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  seal(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const content = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return (
      "v2:" +
      Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64url")
    );
  }
  open(value: string) {
    if (!value) return "";
    const bytes = Buffer.from(
      value.startsWith("v2:") ? value.slice(3) : value,
      "base64url",
    );
    if (value.startsWith("v2:")) {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    }
    if (bytes.length < 73 || bytes[0] !== 128)
      throw new Error("Invalid stored credential");
    const signed = bytes.subarray(0, -32),
      mac = createHmac("sha256", this.key.subarray(0, 16))
        .update(signed)
        .digest();
    if (!timingSafeEqual(mac, bytes.subarray(-32)))
      throw new Error("Invalid stored credential");
    const decipher = createDecipheriv(
      "aes-128-cbc",
      this.key.subarray(16),
      bytes.subarray(9, 25),
    );
    return Buffer.concat([
      decipher.update(bytes.subarray(25, -32)),
      decipher.final(),
    ]).toString("utf8");
  }
}
export class LocalDB {
  raw: Database.Database;
  constructor(public path: string) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.raw = new Database(path);
    this.raw.pragma("foreign_keys=ON");
    this.raw.pragma("journal_mode=WAL");
    this.raw.exec(readFileSync(resolve("server/schema.sql"), "utf8"));
    const additions: Record<string, Record<string, string>> = {
      users: {
        palette: "TEXT NOT NULL DEFAULT 'forest'",
        composer_shade: "TEXT NOT NULL DEFAULT 'mist'",
        composer_size: "TEXT NOT NULL DEFAULT 'compact'",
      },
      settings: {
        platform_name: "TEXT NOT NULL DEFAULT 'Raazi'",
        display_name: "TEXT NOT NULL DEFAULT ''",
        thinking_control: "TEXT NOT NULL DEFAULT 'none'",
        supports_images: "INTEGER NOT NULL DEFAULT 0",
        storage_enabled: "INTEGER NOT NULL DEFAULT 0",
        storage_store_id: "TEXT",
        embedding_url: "TEXT NOT NULL DEFAULT ''",
        embedding_model: "TEXT NOT NULL DEFAULT ''",
        embedding_key: "TEXT NOT NULL DEFAULT ''",
        embedding_dimensions: "INTEGER NOT NULL DEFAULT 768",
        vector_namespace: "TEXT NOT NULL DEFAULT ''",
      },
      documents: {
        index_stage: "TEXT NOT NULL DEFAULT ''",
        index_completed: "INTEGER NOT NULL DEFAULT 0",
        index_total: "INTEGER NOT NULL DEFAULT 0",
        object_ref: "TEXT",
        filename: "TEXT NOT NULL DEFAULT ''",
        mime: "TEXT NOT NULL DEFAULT 'text/plain'",
        original: "BLOB",
        units: "TEXT NOT NULL DEFAULT '[]'",
        status: "TEXT NOT NULL DEFAULT 'ready'",
        error: "TEXT NOT NULL DEFAULT ''",
        warning: "TEXT NOT NULL DEFAULT ''",
        indexed_signature: "TEXT NOT NULL DEFAULT 'keyword'",
        index_backend: "TEXT NOT NULL DEFAULT 'local'",
      },
      messages: {
        attachments: "TEXT NOT NULL DEFAULT '[]'",
        reasoning: "TEXT NOT NULL DEFAULT ''",
      },
      conversations: {
        version: "INTEGER NOT NULL DEFAULT 0",
        group_id: "TEXT REFERENCES chat_groups(id) ON DELETE SET NULL",
        pinned: "INTEGER NOT NULL DEFAULT 0",
        updated_at: "TEXT NOT NULL DEFAULT ''",
      },
    };
    this.raw.exec(
      "CREATE TABLE IF NOT EXISTS chat_groups(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,collapsed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)",
    );
    for (const [table, columns] of Object.entries(additions)) {
      const existing = this.all(`PRAGMA table_info(${table})`).map(
        (r) => r.name,
      );
      for (const [key, ddl] of Object.entries(columns))
        if (!existing.includes(key))
          this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${key} ${ddl}`);
    }
    this.run(
      "UPDATE settings SET vector_namespace=? WHERE vector_namespace=''",
      randomBytes(16).toString("hex"),
    );
    this.run(
      "UPDATE conversations SET updated_at=replace(created_at,' ','T')||'+00:00' WHERE updated_at=''",
    );
    this.raw.exec(
      `CREATE TABLE IF NOT EXISTS passages(id TEXT PRIMARY KEY,doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,content TEXT NOT NULL,page INTEGER,label TEXT NOT NULL,vector TEXT);CREATE INDEX IF NOT EXISTS passages_doc ON passages(doc_id);CREATE INDEX IF NOT EXISTS passages_repo ON passages(repo_id);CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(content,passage_id UNINDEXED);CREATE TRIGGER IF NOT EXISTS passages_delete AFTER DELETE ON passages BEGIN DELETE FROM passages_fts WHERE passage_id=old.id; END;`,
    );
    this.raw.exec(readFileSync(resolve("server/uploads-schema.sql"), "utf8"));
    for (const doc of this.all(
      "SELECT * FROM documents WHERE units='[]' AND content<>''",
    )) {
      const units = [{ text: doc.content, page: null, label: "Text" }];
      this.transaction(() => {
        this.run(
          "UPDATE documents SET units=? WHERE id=?",
          JSON.stringify(units),
          doc.id,
        );
        for (let n = 0; n < doc.content.length; n += 1400) {
          const id = randomBytes(16).toString("hex"),
            content = doc.content.slice(n, n + 1800);
          this.run(
            "INSERT INTO passages(id,doc_id,repo_id,content,page,label) VALUES(?,?,?,?,?,?)",
            id,
            doc.id,
            doc.repo_id,
            content,
            null,
            "Text",
          );
          this.run(
            "INSERT INTO passages_fts(content,passage_id) VALUES(?,?)",
            content,
            id,
          );
        }
      });
    }
  }
  get(sql: string, ...args: any[]): Row | undefined {
    return this.raw.prepare(sql).get(...args) as Row | undefined;
  }
  all(sql: string, ...args: any[]): Row[] {
    return this.raw.prepare(sql).all(...args) as Row[];
  }
  run(sql: string, ...args: any[]) {
    return this.raw.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }
  close() {
    this.raw.close();
  }
}
