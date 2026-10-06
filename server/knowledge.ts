import { extname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Pool } from "pg";
import { Failure, LocalDB, Row, Secrets } from "./db.js";
import { ObjectStorage } from "./storage.js";
import { Mutex } from "./mutex.js";
export interface Unit {
  text: string;
  page: number | null;
  label: string;
}
export interface Passage {
  id: string;
  content: string;
  page: number | null;
  label: string;
}
export async function extractDocument(filename: string, raw: Buffer) {
  if (raw.length > 20 * 1024 * 1024)
    throw new Failure(413, "Uploads are limited to 20 MB.");
  const units: Unit[] = [];
  let mime = "text/plain",
    warning = "",
    total = 0;
  const add = (text: string, page: number | null, label: string) => {
    text = text.trim();
    total += text.length;
    if (total > 500000)
      throw new Failure(
        400,
        "Extracted text exceeds 500,000 characters. Split this document.",
      );
    if (text) units.push({ text, page, label });
  };
  try {
    switch (extname(filename).toLowerCase()) {
      case ".pdf": {
        mime = "application/pdf";
        const task = getDocument({
          data: new Uint8Array(raw),
          isEvalSupported: false,
          disableFontFace: true,
          useSystemFonts: true,
        });
        const doc = await task.promise;
        try {
          if (doc.numPages > 500)
            throw new Failure(400, "PDFs are limited to 500 pages.");
          let blank = 0;
          for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n),
              content = await page.getTextContent();
            const text = content.items
              .map((item) =>
                "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
              )
              .join("")
              .trim();
            if (!text) blank++;
            add(text, n, `Page ${n}`);
            page.cleanup();
          }
          if (blank)
            warning = `${blank} page(s) have no extractable text. Scanned pages require OCR before upload.`;
        } finally {
          await doc.destroy();
        }
        break;
      }
      case ".docx": {
        mime =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        let expanded = 0;
        const files = unzipSync(raw, {
          filter: (entry) => {
            expanded += entry.originalSize;
            if (expanded > 50 * 1024 * 1024)
              throw new Failure(
                400,
                "Expanded DOCX exceeds the 50 MB safety limit.",
              );
            return entry.name === "word/document.xml";
          },
        });
        if (!files["word/document.xml"]) throw new Error("Missing document");
        const xml = strFromU8(files["word/document.xml"]);
        if (/<!DOCTYPE|<!ENTITY/i.test(xml))
          throw new Error("Unsupported XML declaration");
        let invalid = false;
        const tree = new DOMParser({
          errorHandler: {
            warning: () => {},
            error: () => {
              invalid = true;
            },
            fatalError: () => {
              invalid = true;
            },
          },
        }).parseFromString(xml, "text/xml");
        if (invalid) throw new Error("Invalid XML");
        const ns =
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        const body = tree.getElementsByTagNameNS(ns, "body")[0];
        if (!body) throw new Error("Missing body");
        let section = "",
          n = 0;
        for (let block = body.firstChild; block; block = block.nextSibling) {
          if (block.nodeType !== 1) continue;
          const el = block as unknown as Element;
          if (!["p", "tbl"].includes(el.localName)) continue;
          n++;
          const textOf = (node: Element) =>
            Array.from(node.getElementsByTagNameNS(ns, "t"))
              .map((t) => t.textContent ?? "")
              .join("");
          let text = "",
            label = "";
          if (el.localName === "p") {
            text = textOf(el);
            const style =
              el
                .getElementsByTagNameNS(ns, "pStyle")[0]
                ?.getAttributeNS(ns, "val") ?? "";
            if (/^Heading/i.test(style)) section = text;
            label = section ? `${section} / paragraph ${n}` : `Paragraph ${n}`;
          } else {
            text = Array.from(el.getElementsByTagNameNS(ns, "tr"))
              .map((row) =>
                Array.from(row.getElementsByTagNameNS(ns, "tc"))
                  .map(textOf)
                  .join(" | "),
              )
              .join("\n");
            label = section ? `${section} / table ${n}` : `Table ${n}`;
          }
          add(text, null, label);
        }
        break;
      }
      case ".txt":
      case ".md":
        add(
          new TextDecoder("utf-8", { fatal: true }).decode(raw),
          null,
          "Text",
        );
        break;
      default:
        throw new Failure(
          400,
          "Supported formats: PDF, DOCX, UTF-8 TXT and Markdown.",
        );
    }
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure(
      400,
      "Could not read this document. Upload an unencrypted, valid file.",
    );
  }
  if (!units.length)
    throw new Failure(
      400,
      "No text could be extracted. Scanned PDFs require OCR before upload.",
    );
  return { units, mime, warning };
}
export function chunkUnits(units: Unit[]): Passage[] {
  const chunks: Passage[] = [];
  for (const unit of units)
    for (let n = 0; n < unit.text.length; n += 1400) {
      const content = unit.text.slice(n, n + 1800).trim();
      if (content)
        chunks.push({
          id: randomBytes(16).toString("hex"),
          content,
          page: unit.page,
          label: unit.label,
        });
    }
  if (chunks.length > 2000)
    throw new Failure(
      400,
      "Document has too many sections. Split it into smaller files.",
    );
  return chunks;
}
/** Matches Python's original json.dumps fingerprint, preserving existing indexes. */
export function signature(s: Row) {
  if (!s.embedding_url) return "keyword";
  const values = [
    s.embedding_url,
    s.embedding_model,
    s.embedding_dimensions,
    "chunks-v1",
  ];
  const value =
    "[" +
    values
      .map((v) =>
        JSON.stringify(v).replace(
          /[^\x00-\x7f]/g,
          (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
        ),
      )
      .join(", ") +
    "]";
  return createHash("sha256").update(value).digest("hex");
}
export type RequestJSON = (
  url: string,
  body: unknown,
  key: string,
) => Promise<any>;
export const requestJSON: RequestJSON = async (url, body, key) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error("Upstream request failed");
  return response.json();
};
export async function embeddings(
  s: Row,
  secrets: Secrets,
  texts: string[],
  request: RequestJSON = requestJSON,
  onProgress?: (completed: number, total: number) => void,
) {
  const vectors: number[][] = [];
  try {
    for (let n = 0; n < texts.length; n += 32) {
      const batch = texts.slice(n, n + 32),
        response = await request(
          s.embedding_url + "/embeddings",
          { model: s.embedding_model, input: batch, encoding_format: "float" },
          secrets.open(s.embedding_key),
        );
      if (
        !Array.isArray(response.data) ||
        response.data.length !== batch.length
      )
        throw new Error("Count mismatch");
      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      for (const [index, item] of sorted.entries()) {
        if (
          item.index !== index ||
          !Array.isArray(item.embedding) ||
          item.embedding.length !== s.embedding_dimensions ||
          item.embedding.some(
            (x: unknown) => typeof x !== "number" || !Number.isFinite(x),
          )
        )
          throw new Error("Invalid vector");
        const norm = Math.hypot(...item.embedding);
        if (!norm || !Number.isFinite(norm)) throw new Error("Invalid norm");
        vectors.push(item.embedding.map((x: number) => x / norm));
      }
      onProgress?.(vectors.length, texts.length);
    }
    return vectors;
  } catch {
    throw new Failure(
      502,
      "Embedding request failed. Check endpoint, model, credentials, and vector dimensions.",
    );
  }
}
export class Knowledge {
  pool: Pool | null;
  storage?: ObjectStorage;
  lock = new Mutex();
  namespace: string;
  constructor(
    public db: LocalDB,
    public secrets: Secrets,
    url = "",
    public request: RequestJSON = requestJSON,
  ) {
    this.pool = url
      ? new Pool({
          connectionString: url,
          connectionTimeoutMillis: 10000,
          statement_timeout: 30000,
        })
      : null;
    this.namespace = db.get(
      "SELECT vector_namespace FROM settings WHERE id=1",
    )!.vector_namespace;
    const settings = this.settings();
    db.run(
      "UPDATE documents SET status='needs_reindex',error='' WHERE status='ready' AND (indexed_signature<>? OR (indexed_signature<>'keyword' AND index_backend<>?))",
      signature(settings),
      this.pool ? "postgres" : "local",
    );
    db.run(
      "UPDATE documents SET status='failed',error='Indexing was interrupted. Retry this document.' WHERE status='processing'",
    );
  }
  settings() {
    return this.db.get("SELECT * FROM settings WHERE id=1")!;
  }
  table(dim: number) {
    if (!Number.isInteger(dim) || dim < 1 || dim > 2000)
      throw new Failure(400, "Vector dimensions must be between 1 and 2000.");
    return `raazi_vectors_${dim}`;
  }
  async prepare(dim: number) {
    if (!this.pool) return;
    const table = this.table(dim);
    await this.pool.query(
      `CREATE EXTENSION IF NOT EXISTS vector;CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,namespace TEXT NOT NULL,repo_id BIGINT NOT NULL,signature TEXT NOT NULL,embedding vector(${dim}) NOT NULL);CREATE INDEX IF NOT EXISTS ${table}_hnsw ON ${table} USING hnsw(embedding vector_cosine_ops);CREATE INDEX IF NOT EXISTS ${table}_scope ON ${table}(namespace,signature,repo_id);`,
    );
  }
  async remoteDelete(ids: string[], namespace = this.namespace) {
    if (!this.pool || !ids.length) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tables = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'raazi_vectors_%'",
      );
      for (const { tablename } of tables.rows)
        if (/^raazi_vectors_\d+$/.test(tablename))
          await client.query(
            `DELETE FROM ${tablename} WHERE namespace=$1 AND id=ANY($2)`,
            [namespace, ids],
          );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async index(id: number) {
    const doc = this.db.get("SELECT * FROM documents WHERE id=?", id);
    if (!doc) throw new Failure(404, "Document not found");
    this.db.run(
      "UPDATE documents SET status='processing',error='',index_stage='Preparing text',index_completed=0,index_total=0 WHERE id=?",
      id,
    );
    try {
      const s = this.settings(),
        sig = signature(s),
        chunks = chunkUnits(JSON.parse(doc.units));
      const previous = this.db.all("SELECT * FROM passages WHERE doc_id=?", id),
        available = [...previous];
      for (const chunk of chunks) {
        const index = available.findIndex(
          (p) =>
            p.content === chunk.content &&
            p.page === chunk.page &&
            p.label === chunk.label,
        );
        if (index >= 0) {
          chunk.id = available[index].id;
          available.splice(index, 1);
        }
      }
      this.db.run(
        "UPDATE documents SET index_stage=?,index_total=? WHERE id=?",
        s.embedding_url ? "Creating embeddings" : "Building text index",
        chunks.length,
        id,
      );
      const vectors = s.embedding_url
        ? await embeddings(
            s,
            this.secrets,
            chunks.map((c) => c.content),
            this.request,
            (completed, total) =>
              this.db.run(
                "UPDATE documents SET index_completed=?,index_total=? WHERE id=?",
                completed,
                total,
                id,
              ),
          )
        : [];
      this.db.run(
        "UPDATE documents SET index_stage='Saving index' WHERE id=?",
        id,
      );
      if (vectors.length && this.pool) {
        await this.prepare(s.embedding_dimensions);
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          for (let n = 0; n < chunks.length; n++)
            await client.query(
              `INSERT INTO ${this.table(s.embedding_dimensions)}(id,namespace,repo_id,signature,embedding) VALUES($1,$2,$3,$4,$5::vector) ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,embedding=excluded.embedding`,
              [
                chunks[n].id,
                this.namespace,
                doc.repo_id,
                sig,
                JSON.stringify(vectors[n]),
              ],
            );
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      }
      await this.remoteDelete(available.map((p) => p.id));
      this.db.transaction(() => {
        this.db.run("DELETE FROM passages WHERE doc_id=?", id);
        for (let n = 0; n < chunks.length; n++) {
          const c = chunks[n];
          this.db.run(
            "INSERT INTO passages(id,doc_id,repo_id,content,page,label,vector) VALUES(?,?,?,?,?,?,?)",
            c.id,
            id,
            doc.repo_id,
            c.content,
            c.page,
            c.label,
            vectors[n] ? JSON.stringify(vectors[n]) : null,
          );
          this.db.run(
            "INSERT INTO passages_fts(content,passage_id) VALUES(?,?)",
            c.content,
            c.id,
          );
        }
        this.db.run(
          "UPDATE documents SET status='ready',indexed_signature=?,index_backend=?,error='',index_stage='Ready',index_completed=index_total WHERE id=?",
          sig,
          vectors.length && this.pool ? "postgres" : "local",
          id,
        );
      });
      return id;
    } catch (e) {
      this.db.run(
        "UPDATE documents SET status='failed',error=? WHERE id=?",
        e instanceof Failure
          ? e.message
          : "Index storage is unavailable. Check PostgreSQL and retry.",
        id,
      );
      throw e;
    }
  }
  async add(
    repo: number,
    title: string,
    filename: string,
    raw: Buffer,
    uploaded = false,
  ) {
    return this.lock.run(async () => {
      if (!this.db.get("SELECT id FROM repositories WHERE id=?", repo))
        throw new Failure(404, "Repository not found");
      const { units, mime, warning } = await extractDocument(filename, raw);
      const objectRef = uploaded
        ? await this.storage!.put(raw, mime, "knowledge")
        : undefined;
      let id: number;
      try {
        id = Number(
          this.db.run(
            "INSERT INTO documents(repo_id,title,content,filename,mime,original,units,status,warning,object_ref) VALUES(?,?,?,?,?,?,?,'processing',?,?)",
            repo,
            title,
            units.map((u) => u.text).join("\n\n"),
            filename,
            mime,
            uploaded ? null : raw,
            JSON.stringify(units),
            warning,
            objectRef ? JSON.stringify(objectRef) : null,
          ).lastInsertRowid,
        );
      } catch (error) {
        if (objectRef) await this.storage!.delete(objectRef);
        throw error;
      }
      try {
        await this.index(id);
      } catch {
        /* Keep the uploaded document and error for retry. */
      }
      return id;
    });
  }
  async remove(where: "id" | "repo_id", id: number) {
    const docs = this.db.all(
      `SELECT id,object_ref FROM documents WHERE ${where}=?`,
      id,
    );
    for (const doc of docs) {
      const ids = this.db
        .all("SELECT id FROM passages WHERE doc_id=?", doc.id)
        .map((p) => p.id);
      await this.remoteDelete(ids);
      if (doc.object_ref)
        await this.storage!.delete(JSON.parse(doc.object_ref));
      this.db.transaction(() => {
        this.db.run("DELETE FROM chunks WHERE doc_id=?", doc.id);
        this.db.run("DELETE FROM documents WHERE id=?", doc.id);
      });
    }
  }
  source(id: string, allowed: number[]): Row {
    const row = this.db.get(
      "SELECT p.*,d.title,d.filename,d.mime,d.original,d.object_ref,d.warning,d.content AS document_content FROM passages p JOIN documents d ON d.id=p.doc_id WHERE p.id=?",
      id,
    );
    if (!row || !allowed.includes(row.repo_id))
      throw new Failure(404, "Source not found");
    return {
      ...row,
      source_id: row.id,
      document_id: row.doc_id,
      url: "/sources/" + row.id,
    };
  }
  async retrieve(prompt: string, repos: number[], minScore = -1) {
    if (!repos.length) return [];
    const s = this.settings(),
      sig = signature(s),
      marks = repos.map(() => "?").join(",");
    const currentRows = () =>
      this.db.all(
        `SELECT p.*,d.title,d.filename FROM passages p JOIN documents d ON d.id=p.doc_id WHERE d.status='ready' AND d.indexed_signature=? AND p.repo_id IN (${marks})`,
        sig,
        ...repos,
      );
    let selected: Row[] = [];
    if (s.embedding_url) {
      const [vector] = await embeddings(
        s,
        this.secrets,
        [prompt],
        this.request,
      );
      if (this.pool) {
        await this.prepare(s.embedding_dimensions);
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL hnsw.iterative_scan='strict_order'");
          const found = await client.query(
            `SELECT id,1-(embedding <=> $1::vector) AS score FROM ${this.table(s.embedding_dimensions)} WHERE namespace=$2 AND signature=$3 AND repo_id=ANY($4) ORDER BY embedding <=> $1::vector LIMIT 40`,
            [JSON.stringify(vector), this.namespace, sig, repos],
          );
          await client.query("COMMIT");
          const byId = new Map(currentRows().map((r) => [r.id, r]));
          selected = found.rows
            .filter((r) => byId.has(r.id) && Number(r.score) >= minScore)
            .slice(0, 5)
            .map((r) => byId.get(r.id)!);
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      } else
        selected = currentRows()
          .filter((r) => r.vector)
          .map((r) => ({
            ...r,
            score: (JSON.parse(r.vector) as number[]).reduce(
              (a, x, n) => a + x * vector[n],
              0,
            ),
          }))
          .filter((r) => r.score >= minScore)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
    } else {
      const terms = prompt.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 25) ?? [];
      if (terms.length)
        selected = this.db.all(
          `SELECT p.*,d.title,d.filename FROM passages_fts f JOIN passages p ON p.id=f.passage_id JOIN documents d ON d.id=p.doc_id WHERE passages_fts MATCH ? AND d.status='ready' AND d.indexed_signature='keyword' AND p.repo_id IN (${marks}) ORDER BY bm25(passages_fts) LIMIT 5`,
          terms.map((t) => '"' + t + '"').join(" OR "),
          ...repos,
        );
    }
    return selected.map((r) => ({
      source_id: r.id,
      document_id: r.doc_id,
      title: r.title,
      content: r.content,
      page: r.page,
      label: r.label,
      filename: r.filename,
      url: "/sources/" + r.id,
    }));
  }
  documents() {
    return this.db.all(
      "SELECT id,repo_id,title,length(content) AS size,status,error,warning,index_stage,index_completed,index_total FROM documents ORDER BY id DESC",
    );
  }
  async close() {
    await this.pool?.end();
  }
}
