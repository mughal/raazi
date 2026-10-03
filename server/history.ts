import { Pool, PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import { Failure, LocalDB, Row } from "./db.js";
import { Mutex } from "./mutex.js";
import type { Chat, Group } from "../shared/types.js";
export class History {
  pool: Pool | null;
  namespace: string;
  private mutations = new Mutex();
  constructor(
    public db: LocalDB,
    url = "",
  ) {
    this.namespace = db.get(
      "SELECT vector_namespace FROM settings WHERE id=1",
    )!.vector_namespace;
    this.pool = url
      ? new Pool({
          connectionString: url,
          connectionTimeoutMillis: 10000,
          statement_timeout: 30000,
        })
      : null;
  }
  async query(
    sql: string,
    args: any[] = [],
    client?: PoolClient,
  ): Promise<Row[]> {
    if (this.pool) {
      let i = 0;
      return (
        await (client ?? this.pool).query(
          sql.replace(/\?/g, () => `$${++i}`),
          args,
        )
      ).rows;
    }
    if (/^\s*(SELECT|WITH)/i.test(sql)) return this.db.all(sql, ...args);
    this.db.run(sql, ...args);
    return [];
  }
  table(name: "groups" | "conversations" | "messages") {
    return this.pool
      ? "raazi_chat_" + name
      : name === "groups"
        ? "chat_groups"
        : name;
  }
  scope(uid: string) {
    return this.pool
      ? { sql: "namespace=? AND user_id=?", args: [this.namespace, uid] }
      : { sql: "user_id=?", args: [uid] };
  }
  async tx<T>(fn: (client?: PoolClient) => Promise<T>) {
    return this.mutations.run(() => this.transaction(fn));
  }
  async transaction<T>(fn: (client?: PoolClient) => Promise<T>) {
    const client = await this.pool?.connect();
    if (client) await client.query("BEGIN");
    else this.db.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(client);
      if (client) await client.query("COMMIT");
      else this.db.raw.exec("COMMIT");
      return result;
    } catch (error) {
      if (client) await client.query("ROLLBACK");
      else this.db.raw.exec("ROLLBACK");
      throw error;
    } finally {
      client?.release();
    }
  }
  async prepare() {
    if (!this.pool) return;
    await this.tx(async (client) => {
      await client!.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('raazi-chat-schema-v1',0))",
      );
      await client!.query(
        `CREATE TABLE IF NOT EXISTS raazi_chat_groups(namespace TEXT NOT NULL,id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,collapsed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,PRIMARY KEY(namespace,id),UNIQUE(namespace,user_id,id));CREATE TABLE IF NOT EXISTS raazi_chat_conversations(namespace TEXT NOT NULL,id TEXT NOT NULL,user_id TEXT NOT NULL,title TEXT NOT NULL,group_id TEXT,pinned INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(namespace,id),FOREIGN KEY(namespace,user_id,group_id) REFERENCES raazi_chat_groups(namespace,user_id,id));CREATE TABLE IF NOT EXISTS raazi_chat_messages(id BIGSERIAL PRIMARY KEY,namespace TEXT NOT NULL,conversation_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,sources TEXT NOT NULL DEFAULT '[]',FOREIGN KEY(namespace,conversation_id) REFERENCES raazi_chat_conversations(namespace,id) ON DELETE CASCADE);CREATE INDEX IF NOT EXISTS raazi_chat_owner_updated ON raazi_chat_conversations(namespace,user_id,updated_at);CREATE INDEX IF NOT EXISTS raazi_chat_message_order ON raazi_chat_messages(namespace,conversation_id,id);CREATE TABLE IF NOT EXISTS raazi_chat_imports(namespace TEXT PRIMARY KEY,imported_at TEXT NOT NULL);`,
      );
      await client!.query(
        "ALTER TABLE raazi_chat_conversations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0",
      );
      await client!.query(
        "ALTER TABLE raazi_chat_messages ADD COLUMN IF NOT EXISTS attachments TEXT NOT NULL DEFAULT '[]'",
      );
      if (
        (
          await this.query(
            "SELECT 1 FROM raazi_chat_imports WHERE namespace=?",
            [this.namespace],
            client,
          )
        ).length
      )
        return;
      for (const table of ["groups", "conversations"] as const) {
        const keys =
          table === "groups"
            ? ["id", "user_id", "name", "collapsed", "created_at"]
            : [
                "id",
                "user_id",
                "title",
                "group_id",
                "pinned",
                "created_at",
                "updated_at",
              ];
        for (const row of this.db.all(
          `SELECT * FROM ${table === "groups" ? "chat_groups" : table}`,
        ))
          await this.query(
            `INSERT INTO ${this.table(table)}(namespace,${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")},?) ON CONFLICT DO NOTHING`,
            [this.namespace, ...keys.map((k) => row[k])],
            client,
          );
      }
      for (const row of this.db.all("SELECT * FROM messages ORDER BY id"))
        await this.query(
          "INSERT INTO raazi_chat_messages(namespace,conversation_id,role,content,sources,attachments) VALUES(?,?,?,?,?,?)",
          [
            this.namespace,
            row.conversation_id,
            row.role,
            row.content,
            row.sources,
            row.attachments ?? "[]",
          ],
          client,
        );
      await this.query(
        "INSERT INTO raazi_chat_imports(namespace,imported_at) VALUES(?,?)",
        [this.namespace, new Date().toISOString()],
        client,
      );
    });
  }
  async owned(
    uid: string,
    id: string,
    group = false,
    client?: PoolClient,
    lock = false,
  ) {
    const scope = this.scope(uid);
    const rows = await this.query(
      `SELECT * FROM ${this.table(group ? "groups" : "conversations")} WHERE ${scope.sql} AND id=?${client && lock ? " FOR UPDATE" : ""}`,
      [...scope.args, id],
      client,
    );
    if (!rows.length) throw new Failure(404, "Conversation or group not found");
    return rows[0];
  }
  async list(
    uid: string,
  ): Promise<{ conversations: Chat[]; groups: Group[]; chat_storage: string }> {
    const s = this.scope(uid);
    return {
      conversations: (
        await this.query(
          `SELECT * FROM ${this.table("conversations")} WHERE ${s.sql} ORDER BY updated_at DESC,id`,
          s.args,
        )
      ).map((r) => ({ ...r, pinned: !!r.pinned }) as Chat),
      groups: (
        await this.query(
          `SELECT * FROM ${this.table("groups")} WHERE ${s.sql} ORDER BY created_at,id`,
          s.args,
        )
      ).map((r) => ({ ...r, collapsed: !!r.collapsed }) as Group),
      chat_storage: this.pool ? "postgres" : "local",
    };
  }
  async messages(uid: string, id: string, limit?: number) {
    await this.owned(uid, id);
    const args = this.pool ? [this.namespace, id] : [id];
    const rows = await this.query(
      `SELECT * FROM ${this.table("messages")} WHERE ${this.pool ? "namespace=? AND " : ""}conversation_id=? ORDER BY id ${limit ? "DESC LIMIT ?" : ""}`,
      [...args, ...(limit ? [limit] : [])],
    );
    return limit ? rows.reverse() : rows;
  }
  async createGroup(uid: string, name: string) {
    const id = randomBytes(18).toString("base64url");
    const keys = ["id", "user_id", "name", "created_at"],
      values = [id, uid, name, new Date().toISOString()];
    if (this.pool) {
      keys.unshift("namespace");
      values.unshift(this.namespace);
    }
    await this.query(
      `INSERT INTO ${this.table("groups")}(${keys}) VALUES(${keys.map(() => "?")})`,
      values,
    );
    return id;
  }
  async update(uid: string, id: string, data: Row, group = false) {
    await this.tx(async (c) => {
      if (!group && data.group_id)
        await this.owned(uid, data.group_id, true, c, true);
      await this.owned(uid, id, group, c, true);
      const s = this.scope(uid);
      await this.query(
        `UPDATE ${this.table(group ? "groups" : "conversations")} SET ${Object.keys(
          data,
        )
          .map((k) => k + "=?")
          .join(",")} WHERE ${s.sql} AND id=?`,
        [...Object.values(data), ...s.args, id],
        c,
      );
    });
  }
  async delete(uid: string, id: string, group = false) {
    await this.tx(async (c) => {
      await this.owned(uid, id, group, c, true);
      const s = this.scope(uid);
      if (group)
        await this.query(
          `UPDATE ${this.table("conversations")} SET group_id=NULL WHERE ${s.sql} AND group_id=?`,
          [...s.args, id],
          c,
        );
      await this.query(
        `DELETE FROM ${this.table(group ? "groups" : "conversations")} WHERE ${s.sql} AND id=?`,
        [...s.args, id],
        c,
      );
    });
  }
  async append(
    uid: string,
    id: string | undefined,
    prompt: string,
    answer: string,
    sources: unknown[],
    group: string | null,
    attachments: unknown[] = [],
    revision?: { messageId: string; tailId: string; version: number },
  ) {
    return this.tx(async (c) => {
      const now = new Date().toISOString();
      if (id) {
        const conversation = await this.owned(uid, id, false, c, true);
        if (revision && conversation.version !== revision.version)
          throw new Failure(
            409,
            "This chat changed while generating. Reload it and retry.",
          );
        if (revision) {
          const scope = this.pool
              ? "namespace=? AND conversation_id=?"
              : "conversation_id=?",
            args = this.pool ? [this.namespace, id] : [id];
          const target = (
            await this.query(
              "SELECT * FROM " +
                this.table("messages") +
                " WHERE " +
                scope +
                " AND id=?",
              [...args, revision.messageId],
              c,
            )
          )[0];
          const tail = (
            await this.query(
              "SELECT id FROM " +
                this.table("messages") +
                " WHERE " +
                scope +
                " ORDER BY id DESC LIMIT 1",
              args,
              c,
            )
          )[0];
          if (!target || target.role !== "user")
            throw new Failure(404, "Question not found.");
          if (String(tail?.id) !== revision.tailId)
            throw new Failure(
              409,
              "This chat changed while generating. Reload it and retry.",
            );
          await this.query(
            "DELETE FROM " +
              this.table("messages") +
              " WHERE " +
              scope +
              " AND id>=?",
            [...args, revision.messageId],
            c,
          );
        }
      } else {
        if (group) await this.owned(uid, group, true, c, true);
        id = randomBytes(18).toString("base64url");
        const keys = [
          "id",
          "user_id",
          "title",
          "group_id",
          "created_at",
          "updated_at",
        ];
        const values: any[] = [id, uid, prompt.slice(0, 70), group, now, now];
        if (this.pool) {
          keys.unshift("namespace");
          values.unshift(this.namespace);
        }
        await this.query(
          `INSERT INTO ${this.table("conversations")}(${keys}) VALUES(${keys.map(() => "?")})`,
          values,
          c,
        );
      }
      for (const [role, content, refs] of [
        ["user", prompt, "[]"],
        ["assistant", answer, JSON.stringify(sources)],
      ]) {
        const keys = [
            "conversation_id",
            "role",
            "content",
            "sources",
            "attachments",
          ],
          values: any[] = [
            id,
            role,
            content,
            refs,
            role === "user" ? JSON.stringify(attachments) : "[]",
          ];
        if (this.pool) {
          keys.unshift("namespace");
          values.unshift(this.namespace);
        }
        await this.query(
          `INSERT INTO ${this.table("messages")}(${keys}) VALUES(${keys.map(() => "?")})`,
          values,
          c,
        );
      }
      const s = this.scope(uid);
      await this.query(
        `UPDATE ${this.table("conversations")} SET updated_at=?,version=version+1 WHERE ${s.sql} AND id=?`,
        [now, ...s.args, id],
        c,
      );
      return id!;
    });
  }
  async close() {
    await this.pool?.end();
  }
}
