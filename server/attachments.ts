import { randomBytes, createHash } from "node:crypto";
import { extname } from "node:path";
import sharp from "sharp";
import { Failure, LocalDB, Row } from "./db.js";
import { ObjectStorage } from "./storage.js";
import {
  Knowledge,
  extractDocument,
  chunkUnits,
  embeddings,
  signature,
  Unit,
} from "./knowledge.js";
import type { Attachment, Source } from "../shared/types.js";
const IMAGE_LIMIT = 10 * 1024 * 1024;
export class Attachments {
  constructor(
    public db: LocalDB,
    public storage: ObjectStorage,
    public knowledge: Knowledge,
    public imagesEnabled: () => boolean = () =>
      !!knowledge.settings().supports_images,
  ) {
    db.run(
      "UPDATE attachments SET status='failed',error='Processing stopped. Retry this file.' WHERE status='processing'",
    );
    db.run(
      "UPDATE attachments SET status='needs_reindex' WHERE kind='document' AND status='ready' AND (indexed_signature<>? OR (indexed_signature<>'keyword' AND index_backend<>?))",
      signature(knowledge.settings()),
      knowledge.pool ? "postgres" : "local",
    );
  }
  get(uid: string, id: string) {
    const row = this.db.get(
      "SELECT * FROM attachments WHERE id=? AND user_id=?",
      id,
      uid,
    );
    if (!row) throw new Failure(404, "File not found.");
    return row;
  }
  public(row: Row): Attachment {
    return {
      id: row.id,
      filename: row.filename,
      mime: row.mime,
      kind: row.kind,
      size: row.size,
      status: row.status,
      error: row.error,
      warning: row.warning,
      search_mode:
        row.kind === "image"
          ? "vision"
          : row.indexed_signature === "keyword"
            ? "keyword"
            : "vector",
      file_url: "/api/attachments/" + row.id + "/file",
      created_at: row.created_at,
    };
  }
  list(uid: string) {
    return this.db
      .all(
        "SELECT * FROM attachments WHERE user_id=? ORDER BY created_at DESC",
        uid,
      )
      .map((r) => this.public(r));
  }
  namespace(uid: string) {
    return (
      this.storage.namespace() +
      ":attachments:" +
      createHash("sha256").update(uid).digest("hex")
    );
  }
  async upload(uid: string, filename: string, raw: Buffer) {
    return this.knowledge.lock.run(async () => {
      const extension = extname(filename).toLowerCase(),
        image = [".png", ".jpg", ".jpeg", ".webp"].includes(extension);
      if (
        ![
          ".pdf",
          ".docx",
          ".txt",
          ".md",
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
        ].includes(extension)
      )
        throw new Failure(
          400,
          "This file format is not supported yet. Use PDF, DOCX, TXT, Markdown, PNG, JPEG, or WebP.",
        );
      if (raw.length > 20 * 1024 * 1024)
        throw new Failure(413, "Files must not exceed 20 MB.");
      let mime = "application/octet-stream",
        units: Unit[] = [],
        warning = "",
        error = "",
        status = "processing";
      if (image) {
        if (!this.imagesEnabled())
          throw new Failure(
            400,
            "This model does not accept images. Ask an admin to enable an image model.",
          );
        if (raw.length > IMAGE_LIMIT)
          throw new Failure(413, "Images must not exceed 10 MB.");
        try {
          const parser = sharp(raw, {
              limitInputPixels: 16000000,
              animated: true,
            }),
            metadata = await parser.metadata();
          if (
            !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
            !metadata.width ||
            !metadata.height ||
            (metadata.pages ?? 1) > 1
          )
            throw new Error("Unsupported image");
          await parser.stats();
          mime = "image/" + metadata.format;
          status = "ready";
          warning =
            "Image analysis is available. Image knowledge indexing is not supported yet.";
        } catch {
          throw new Failure(
            400,
            "Cannot read this image. Use a valid, still PNG, JPEG, or WebP image with at most 16 million pixels.",
          );
        }
      } else {
        mime =
          extension === ".pdf"
            ? "application/pdf"
            : extension === ".docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "text/plain";
        try {
          const extracted = await extractDocument(filename, raw);
          units = extracted.units;
          mime = extracted.mime;
          warning = extracted.warning;
        } catch (e) {
          status = "unsupported";
          error =
            e instanceof Failure ? e.message : "Cannot read this document.";
          if (/No text|Scanned/.test(error))
            error =
              "Scanned documents are not supported yet. Apply OCR, then upload the file again.";
        }
      }
      const ref = await this.storage.put(raw, mime, "uploads"),
        id = randomBytes(16).toString("hex");
      try {
        this.db.run(
          "INSERT INTO attachments(id,user_id,filename,mime,kind,size,object_ref,units,status,error,warning,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          uid,
          filename,
          mime,
          image ? "image" : "document",
          raw.length,
          JSON.stringify(ref),
          JSON.stringify(units),
          status,
          error,
          warning,
          new Date().toISOString(),
        );
        await this.storage.writeMetadata("attachments", id);
      } catch (e) {
        this.db.run("DELETE FROM attachments WHERE id=?", id);
        await this.storage.delete(ref);
        throw e;
      }
      if (!image && status === "processing")
        try {
          await this.index(uid, id);
        } catch {
          /* Keep original and extracted text for retry. */
        }
      return this.public(this.get(uid, id));
    });
  }
  async index(uid: string, id: string) {
    const file = this.get(uid, id);
    if (file.kind !== "document" || file.status === "unsupported")
      throw new Failure(
        400,
        "Knowledge indexing is not supported for this file.",
      );
    this.db.run(
      "UPDATE attachments SET status='processing',error='' WHERE id=?",
      id,
    );
    try {
      const settings = this.knowledge.settings(),
        sig = signature(settings),
        chunks = chunkUnits(JSON.parse(file.units)),
        previous = this.db.all(
          "SELECT * FROM attachment_passages WHERE attachment_id=?",
          id,
        ),
        unused = [...previous];
      for (const chunk of chunks) {
        const index = unused.findIndex(
          (p) =>
            p.content === chunk.content &&
            p.page === chunk.page &&
            p.label === chunk.label,
        );
        if (index >= 0) {
          chunk.id = unused[index].id;
          unused.splice(index, 1);
        }
      }
      const vectors = settings.embedding_url
          ? await embeddings(
              settings,
              this.knowledge.secrets,
              chunks.map((c) => c.content),
              this.knowledge.request,
            )
          : [],
        pool = this.knowledge.pool,
        namespace = this.namespace(uid);
      if (pool && vectors.length) {
        await this.knowledge.prepare(settings.embedding_dimensions);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (let n = 0; n < chunks.length; n++)
            await client.query(
              "INSERT INTO " +
                this.knowledge.table(settings.embedding_dimensions) +
                "(id,namespace,repo_id,signature,embedding) VALUES($1,$2,0,$3,$4::vector) ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,embedding=excluded.embedding",
              [chunks[n].id, namespace, sig, JSON.stringify(vectors[n])],
            );
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      }
      await this.knowledge.remoteDelete(
        unused.map((p) => p.id),
        namespace,
      );
      this.db.transaction(() => {
        this.db.run(
          "DELETE FROM attachment_passages WHERE attachment_id=?",
          id,
        );
        for (let n = 0; n < chunks.length; n++) {
          const c = chunks[n];
          this.db.run(
            "INSERT INTO attachment_passages(id,attachment_id,content,page,label,vector) VALUES(?,?,?,?,?,?)",
            c.id,
            id,
            c.content,
            c.page,
            c.label,
            vectors[n] ? JSON.stringify(vectors[n]) : null,
          );
          this.db.run(
            "INSERT INTO attachment_passages_fts(content,passage_id) VALUES(?,?)",
            c.content,
            c.id,
          );
        }
        this.db.run(
          "UPDATE attachments SET status='ready',error='',indexed_signature=?,index_backend=? WHERE id=?",
          sig,
          vectors.length && pool ? "postgres" : "local",
          id,
        );
      });
    } catch (e) {
      this.db.run(
        "UPDATE attachments SET status='failed',error=? WHERE id=?",
        e instanceof Failure
          ? e.message
          : "Cannot write the vector index. Check PostgreSQL, then retry.",
        id,
      );
      throw e;
    }
  }
  async remove(uid: string, id: string) {
    return this.knowledge.lock.run(async () => {
      const file = this.get(uid, id),
        ids = this.db
          .all("SELECT id FROM attachment_passages WHERE attachment_id=?", id)
          .map((p) => p.id);
      await this.knowledge.remoteDelete(ids, this.namespace(uid));
      await this.storage.delete(JSON.parse(file.object_ref));
      this.db.run("DELETE FROM attachments WHERE id=? AND user_id=?", id, uid);
    });
  }
  source(uid: string, id: string): Row | undefined {
    const row = this.db.get(
      "SELECT p.*,a.filename,a.mime,a.warning,a.object_ref,a.user_id FROM attachment_passages p JOIN attachments a ON a.id=p.attachment_id WHERE p.id=? AND a.user_id=?",
      id,
      uid,
    );
    return row
      ? {
          ...row,
          source_id: row.id,
          document_id: null,
          title: row.filename,
          url: "/sources/" + row.id,
        }
      : undefined;
  }
  async original(uid: string, id: string) {
    return this.storage.get(JSON.parse(this.get(uid, id).object_ref));
  }
  selected(uid: string, ids: string[], strict = true) {
    const files: Row[] = [];
    for (const id of [...new Set(ids)]) {
      const row = this.db.get(
        "SELECT * FROM attachments WHERE id=? AND user_id=?",
        id,
        uid,
      );
      if (!row) {
        if (strict) throw new Failure(404, "File not found.");
        continue;
      }
      if (row.status !== "ready") {
        if (strict)
          throw new Failure(
            400,
            row.filename +
              ": " +
              (row.error || "Reindex this file before use."),
          );
        continue;
      }
      if (
        row.kind === "document" &&
        row.indexed_signature !== signature(this.knowledge.settings())
      )
        throw new Failure(
          400,
          row.filename + ": Reindex this file in Your files.",
        );
      if (row.kind === "image" && !this.imagesEnabled())
        throw new Failure(
          400,
          "This model does not accept images. Ask an admin to enable an image model.",
        );
      files.push(row);
    }
    return files;
  }
  async retrieve(
    uid: string,
    prompt: string,
    ids: string[],
  ): Promise<Source[]> {
    if (!ids.length) return [];
    const settings = this.knowledge.settings(),
      sig = signature(settings),
      marks = ids.map(() => "?").join(",");
    const current = () =>
      this.db.all(
        "SELECT p.*,a.filename FROM attachment_passages p JOIN attachments a ON a.id=p.attachment_id WHERE a.user_id=? AND a.id IN (" +
          marks +
          ") AND a.status='ready' AND a.indexed_signature=?",
        uid,
        ...ids,
        sig,
      );
    let selected: Row[] = [];
    if (settings.embedding_url) {
      const [vector] = await embeddings(
        settings,
        this.knowledge.secrets,
        [prompt],
        this.knowledge.request,
      );
      if (this.knowledge.pool) {
        await this.knowledge.prepare(settings.embedding_dimensions);
        const client = await this.knowledge.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL hnsw.iterative_scan='strict_order'");
          const result = await client.query(
            "SELECT id FROM " +
              this.knowledge.table(settings.embedding_dimensions) +
              " WHERE namespace=$1 AND signature=$2 AND id=ANY($4) ORDER BY embedding <=> $3::vector LIMIT 4",
            [
              this.namespace(uid),
              sig,
              JSON.stringify(vector),
              current().map((p) => p.id),
            ],
          );
          await client.query("COMMIT");
          const map = new Map(current().map((p) => [p.id, p]));
          selected = result.rows
            .filter((p) => map.has(p.id))
            .slice(0, 4)
            .map((p) => map.get(p.id)!);
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      } else
        selected = current()
          .filter((p) => p.vector)
          .map((p) => ({
            ...p,
            score: (JSON.parse(p.vector) as number[]).reduce(
              (total, x, n) => total + x * vector[n],
              0,
            ),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 4);
    } else {
      const terms = prompt.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 25) ?? [];
      if (terms.length)
        selected = this.db.all(
          "SELECT p.*,a.filename FROM attachment_passages_fts f JOIN attachment_passages p ON p.id=f.passage_id JOIN attachments a ON a.id=p.attachment_id WHERE attachment_passages_fts MATCH ? AND a.user_id=? AND a.id IN (" +
            marks +
            ") AND a.status='ready' AND a.indexed_signature='keyword' ORDER BY bm25(attachment_passages_fts) LIMIT 4",
          terms.map((t) => '"' + t + '"').join(" OR "),
          uid,
          ...ids,
        );
      // A document can answer a broad question even if the prompt has no matching keywords.
      if (!selected.length) selected = current().slice(0, 4);
    }
    return selected.map((p) => ({
      source_id: p.id,
      document_id: null,
      attachment_id: p.attachment_id,
      title: p.filename,
      content: p.content,
      page: p.page,
      label: p.label,
      filename: p.filename,
      url: "/sources/" + p.id,
    }));
  }
  async imageParts(uid: string, files: Row[]) {
    const images = files.filter((f) => f.kind === "image");
    if (images.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024)
      throw new Failure(
        400,
        "Image data exceeds 20 MB. Start a new chat with fewer images.",
      );
    return Promise.all(
      images.map(async (f) => ({
        type: "image_url",
        image_url: {
          url:
            "data:" +
            f.mime +
            ";base64," +
            (await this.original(uid, f.id)).toString("base64"),
        },
      })),
    );
  }
}
