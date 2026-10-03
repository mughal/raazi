import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { LocalDB, Secrets } from "../server/db";
import { History } from "../server/history";
import { Knowledge } from "../server/knowledge";
import { mockRequest } from "./fixtures";
const url = process.env.RAAZI_TEST_DATABASE_URL;
it.skipIf(!url)(
  "imports chat history once, enforces ownership and retains folder messages in PostgreSQL",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "raazi-pg-test-")),
      db = new LocalDB(join(root, "db.sqlite"));
    db.run(
      "INSERT INTO users(id,name,email,role) VALUES('u','User','u@test','user')",
    );
    db.run(
      "INSERT INTO users(id,name,email,role) VALUES('v','Other','v@test','user')",
    );
    const local = new History(db);
    await local.createGroup("u", "Local folder");
    const group = (await local.list("u")).groups[0].id,
      id = await local.append("u", undefined, "Hello", "Hi", [], group),
      pg = new History(db, url);
    try {
      await pg.prepare();
      expect((await pg.list("u")).conversations).toHaveLength(1);
      expect(await pg.messages("u", id)).toHaveLength(2);
      await expect(pg.messages("v", id)).rejects.toThrow();
      await pg.delete("u", group, true);
      expect((await pg.list("u")).conversations[0].group_id).toBeNull();
      await pg.append("u", id, "Again", "Reply", [], null);
      expect(await pg.messages("u", id)).toHaveLength(4);
      await pg.delete("u", id);
      await pg.prepare();
      expect((await pg.list("u")).conversations).toHaveLength(0);
      expect((await local.list("u")).conversations).toHaveLength(1);
    } finally {
      if (pg.pool) {
        await pg.pool.query(
          "DELETE FROM raazi_chat_conversations WHERE namespace=$1",
          [pg.namespace],
        );
        await pg.pool.query(
          "DELETE FROM raazi_chat_groups WHERE namespace=$1",
          [pg.namespace],
        );
        await pg.pool.query(
          "DELETE FROM raazi_chat_imports WHERE namespace=$1",
          [pg.namespace],
        );
      }
      await pg.close();
      db.close();
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
        throw new Error("Unsafe cleanup");
      rmSync(root, { recursive: true, force: true });
    }
  },
);
it.skipIf(!url)(
  "indexes and retrieves pgvector passages using the persistent workspace namespace",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "raazi-pg-test-")),
      db = new LocalDB(join(root, "db.sqlite")),
      knowledge = new Knowledge(
        db,
        new Secrets(root, "development"),
        url,
        mockRequest,
      );
    db.run("INSERT INTO repositories(id,name) VALUES(1,'Policies')");
    db.run(
      "UPDATE settings SET embedding_url='http://fixture/v1',embedding_model='fixture',embedding_dimensions=3 WHERE id=1",
    );
    try {
      await knowledge.add(
        1,
        "Leave",
        "leave.txt",
        Buffer.from("Annual leave is 25 days."),
      );
      await knowledge.add(
        1,
        "Travel",
        "travel.txt",
        Buffer.from("Travel requires manager approval."),
      );
      const found = await knowledge.retrieve("travel manager", [1]);
      expect(found[0].title).toBe("Travel");
      expect(await knowledge.retrieve("travel manager", [])).toHaveLength(0);
      const source = found[0].source_id;
      await knowledge.lock.run(() =>
        knowledge.remove("id", found[0].document_id),
      );
      expect(
        (await knowledge.retrieve("travel", [1])).some(
          (s) => s.source_id === source,
        ),
      ).toBe(false);
    } finally {
      await knowledge.remoteDelete(
        db.all("SELECT id FROM passages").map((p) => p.id),
      );
      await knowledge.close();
      db.close();
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
        throw new Error("Unsafe cleanup");
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(!url)(
  "isolates private pgvector files and preserves attachment snapshots in PostgreSQL history",
  async () => {
    const { ObjectStorage } = await import("../server/storage"),
      { Attachments } = await import("../server/attachments"),
      { memoryStorage, storageInput } = await import("./storage-fixture");
    const root = mkdtempSync(join(tmpdir(), "raazi-pg-test-")),
      db = new LocalDB(join(root, "db.sqlite")),
      secrets = new Secrets(root, "development"),
      knowledge = new Knowledge(db, secrets, url, mockRequest),
      storage = new ObjectStorage(db, secrets, memoryStorage().factory),
      files = new Attachments(db, storage, knowledge),
      history = new History(db, url);
    db.run(
      "INSERT INTO users(id,name,email,role) VALUES('u','User','u@test','user'),('v','Other','v@test','user')",
    );
    db.run(
      "UPDATE settings SET embedding_url='http://fixture/v1',embedding_model='fixture',embedding_dimensions=3 WHERE id=1",
    );
    try {
      await storage.save(storageInput);
      await history.prepare();
      const selected = await files.upload(
        "u",
        "selected.txt",
        Buffer.from("Manager approval is required for travel."),
      );
      const unrelated = await files.upload(
        "u",
        "unrelated.txt",
        Buffer.from("Travel expenses follow a different rule."),
      );
      const other = await files.upload(
        "v",
        "secret.txt",
        Buffer.from("Manager approval is private to another account."),
      );
      expect(selected.status).toBe("ready");
      expect(unrelated.status).toBe("ready");
      expect(other.status).toBe("ready");
      const found = await files.retrieve("u", "manager travel", [selected.id]);
      expect(found).toHaveLength(1);
      expect(found[0].attachment_id).toBe(selected.id);
      expect(
        await files.retrieve("v", "manager travel", [selected.id]),
      ).toHaveLength(0);
      expect(await knowledge.retrieve("travel", [1])).toHaveLength(0);
      const cid = await history.append(
        "u",
        undefined,
        "Question",
        "Answer",
        found,
        null,
        [selected],
      );
      expect(
        JSON.parse((await history.messages("u", cid))[0].attachments)[0].id,
      ).toBe(selected.id);
      await files.remove("u", selected.id);
      expect(await files.retrieve("u", "travel", [selected.id])).toHaveLength(
        0,
      );
      await history.delete("u", cid);
    } finally {
      if (knowledge.pool)
        for (const uid of ["u", "v"])
          await knowledge.pool.query(
            "DELETE FROM " + knowledge.table(3) + " WHERE namespace=$1",
            [files.namespace(uid)],
          );
      if (history.pool) {
        await history.pool.query(
          "DELETE FROM raazi_chat_conversations WHERE namespace=$1",
          [history.namespace],
        );
        await history.pool.query(
          "DELETE FROM raazi_chat_imports WHERE namespace=$1",
          [history.namespace],
        );
      }
      await history.close();
      await knowledge.close();
      db.close();
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
        throw new Error("Unsafe cleanup");
      rmSync(root, { recursive: true, force: true });
    }
  },
);
