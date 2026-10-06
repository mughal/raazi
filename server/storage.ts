import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Failure, LocalDB, Secrets, Row } from "./db.js";
import { Mutex } from "./mutex.js";
export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  force_path_style: boolean;
  access_key: string;
  secret_key: string;
}
export interface ObjectRef {
  store_id: string;
  key: string;
  version_id?: string;
  sha256: string;
  size: number;
}
export interface ObjectClient {
  head(): Promise<void>;
  put(
    key: string,
    body: Buffer,
    mime: string,
  ): Promise<{ version_id?: string }>;
  get(key: string, version?: string): Promise<Buffer>;
  delete(key: string, version?: string): Promise<void>;
  close(): void;
}
export type ObjectFactory = (settings: StorageConfig) => ObjectClient;
function storageTestHint(error: unknown): string {
  const hints: Record<string, string> = {
    CERT_HAS_EXPIRED: "The TLS certificate has expired.",
    DEPTH_ZERO_SELF_SIGNED_CERT:
      "The TLS certificate is self-signed. Install the storage CA certificate in the app container.",
    SELF_SIGNED_CERT_IN_CHAIN:
      "The TLS certificate chain is not trusted. Install the storage CA chain in the app container.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
      "The TLS certificate chain cannot be verified. Install the issuing CA chain in the app container.",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
      "The issuing TLS CA is not trusted by the app container.",
    ERR_TLS_CERT_ALTNAME_INVALID:
      "The endpoint hostname does not match the TLS certificate.",
    ENOTFOUND: "The app container cannot resolve the endpoint hostname.",
    EAI_AGAIN: "DNS lookup failed. Check DNS from the app container.",
    ECONNREFUSED:
      "The endpoint refused the connection. Check the port and service.",
    ETIMEDOUT:
      "The connection timed out. Check routing and firewall access from the app container.",
    AbortError: "The storage request timed out.",
    TimeoutError: "The storage request timed out.",
    AccessDenied:
      "Access was denied. Check the keys and bucket permissions, including bucket access (HeadBucket).",
    InvalidAccessKeyId: "The access key ID was rejected.",
    SignatureDoesNotMatch:
      "The signature was rejected. Check the secret key, signing region, and server clock.",
    AuthorizationHeaderMalformed:
      "The authentication header was rejected. Check the signing region.",
    RequestTimeTooSkewed:
      "The server clock differs from the storage clock. Check time synchronization.",
    NoSuchBucket:
      "The bucket was not found. Check the bucket name and endpoint.",
  };
  let value: any = error;
  const seen = new Set();
  let status: number | undefined;
  for (let i = 0; value && i < 5 && !seen.has(value); i++) {
    seen.add(value);
    for (const code of [value.code, value.name])
      if (typeof code === "string" && Object.hasOwn(hints, code))
        return hints[code];
    status ??= value.$metadata?.httpStatusCode;
    value = value.cause;
  }
  if (status === 403)
    return "HTTP 403: storage denied access. Check keys and bucket access permissions. This response does not identify which one failed.";
  if (status === 404)
    return "HTTP 404: check the S3 endpoint, bucket name, and path-style addressing.";
  if (status === 301 || status === 307)
    return "Storage redirected the request. Check the S3 endpoint and signing region.";
  if (status && Number.isInteger(status) && status >= 400 && status <= 599)
    return `Storage returned HTTP ${status}. Check the S3 endpoint and storage service.`;
  return "Check the endpoint, keys, bucket permissions, and certificate trust.";
}
const MAX_OBJECT = 20 * 1024 * 1024;
export const s3Factory: ObjectFactory = (s) => {
  const client = new S3Client({
    endpoint: s.endpoint,
    region: s.region,
    forcePathStyle: s.force_path_style,
    credentials: { accessKeyId: s.access_key, secretAccessKey: s.secret_key },
    maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const send = (command: any) =>
    client.send(command, {
      abortSignal: AbortSignal.timeout(30000),
    }) as Promise<any>;
  return {
    head: async () => {
      await send(new HeadBucketCommand({ Bucket: s.bucket }));
    },
    put: async (key, body, mime) => {
      const result = await send(
        new PutObjectCommand({
          Bucket: s.bucket,
          Key: key,
          Body: body,
          ContentType: mime,
          ContentMD5: createHash("md5").update(body).digest("base64"),
        }),
      );
      return { version_id: result.VersionId };
    },
    get: async (key, version) => {
      const result = await send(
        new GetObjectCommand({
          Bucket: s.bucket,
          Key: key,
          VersionId: version,
        }),
      );
      if (result.ContentLength > MAX_OBJECT || !result.Body)
        throw new Error("Object exceeds limit");
      const parts: Buffer[] = [];
      let size = 0;
      try {
        for await (const part of result.Body) {
          const bytes = Buffer.from(part);
          size += bytes.length;
          if (size > MAX_OBJECT) throw new Error("Object exceeds limit");
          parts.push(bytes);
        }
        return Buffer.concat(parts);
      } finally {
        result.Body.destroy?.();
      }
    },
    delete: async (key, version) => {
      await send(
        new DeleteObjectCommand({
          Bucket: s.bucket,
          Key: key,
          VersionId: version,
        }),
      );
    },
    close: () => client.destroy(),
  };
};
export const storageSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().trim().max(1000).default(""),
  region: z.string().trim().min(1).max(100).default("us-east-1"),
  bucket: z.string().trim().max(200).default(""),
  prefix: z.string().trim().max(200).default("raazi"),
  force_path_style: z.boolean().default(true),
  access_key: z.string().trim().max(4000).default(""),
  secret_key: z.string().max(4000).default(""),
});
export type StorageInput = z.infer<typeof storageSchema>;
export class ObjectStorage {
  lock = new Mutex();
  constructor(
    public db: LocalDB,
    public secrets: Secrets,
    public factory: ObjectFactory = s3Factory,
  ) {}
  active() {
    const setting = this.db.get(
      "SELECT storage_enabled,storage_store_id FROM settings WHERE id=1",
    )!;
    return setting.storage_store_id
      ? this.db.get(
          "SELECT * FROM object_stores WHERE id=?",
          setting.storage_store_id,
        )
      : undefined;
  }
  publicSettings() {
    const s = this.active(),
      enabled = !!this.db.get(
        "SELECT storage_enabled FROM settings WHERE id=1",
      )!.storage_enabled;
    return {
      enabled,
      endpoint: s?.endpoint ?? "",
      region: s?.region ?? "us-east-1",
      bucket: s?.bucket ?? "",
      prefix: s?.prefix ?? "raazi",
      force_path_style: s ? !!s.force_path_style : true,
      has_access_key: !!s?.access_key,
      has_secret_key: !!s?.secret_key,
    };
  }
  candidate(input: StorageInput): StorageConfig {
    const old = this.active();
    let endpoint: string;
    try {
      const url = new URL(input.endpoint);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.hostname
      )
        throw new Error("Invalid endpoint");
      endpoint = url.href.replace(/\/+$/, "");
    } catch {
      throw new Failure(
        400,
        "Enter an HTTP or HTTPS S3 endpoint without credentials, a query, or a fragment.",
      );
    }
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,198}[a-zA-Z0-9]$/.test(input.bucket) ||
      input.bucket.includes("..")
    )
      throw new Failure(400, "Enter a valid bucket name.");
    const prefix = input.prefix.replace(/^\/+|\/+$/g, "");
    if (
      prefix.split("/").some((p) => p === "." || p === "..") ||
      /[\u0000-\u001f\\]/.test(prefix)
    )
      throw new Failure(400, "Enter a valid object prefix.");
    const reuse = old?.endpoint === endpoint,
      access_key =
        input.access_key || (reuse ? this.secrets.open(old!.access_key) : ""),
      secret_key =
        input.secret_key || (reuse ? this.secrets.open(old!.secret_key) : "");
    if (!access_key || !secret_key)
      throw new Failure(
        400,
        "Enter both S3 keys. A new endpoint requires new keys.",
      );
    return {
      endpoint,
      region: input.region,
      bucket: input.bucket,
      prefix,
      force_path_style: input.force_path_style,
      access_key,
      secret_key,
    };
  }
  async test(s: StorageConfig) {
    const client = this.factory(s),
      key = [
        s.prefix,
        this.namespace(),
        "_checks",
        randomBytes(16).toString("hex"),
      ]
        .filter(Boolean)
        .join("/"),
      body = randomBytes(32);
    let attempted = false,
      version: string | undefined,
      error: unknown,
      step = "access",
      cleanup = true;
    try {
      await client.head();
      step = "write";
      attempted = true;
      version = (await client.put(key, body, "application/octet-stream"))
        .version_id;
      step = "read";
      if (!(await client.get(key, version)).equals(body))
        throw new Error("Read mismatch");
    } catch (e) {
      error = e;
    } finally {
      if (attempted)
        try {
          await client.delete(key, version);
        } catch {
          cleanup = false;
        }
      client.close();
    }
    if (!cleanup)
      throw new Failure(
        502,
        "Cannot delete the test object. Remove this object before retry: " +
          key,
      );
    if (error)
      throw new Failure(
        502,
        "Bucket test failed during " + step + ". " + storageTestHint(error),
      );
    return { accessible: true, writable: true, readable: true, cleanup: true };
  }
  async save(input: StorageInput) {
    return this.lock.run(async () => {
      if (!input.enabled) {
        this.db.run("UPDATE settings SET storage_enabled=0 WHERE id=1");
        return;
      }
      const s = this.candidate(input);
      await this.test(s);
      const previous = this.db.get(
          "SELECT id FROM object_stores WHERE endpoint=? AND bucket=?",
          s.endpoint,
          s.bucket,
        ),
        id = previous?.id ?? randomBytes(16).toString("hex");
      this.db.transaction(() => {
        this.db.run(
          "INSERT INTO object_stores(id,endpoint,region,bucket,prefix,force_path_style,access_key,secret_key) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET region=excluded.region,prefix=excluded.prefix,force_path_style=excluded.force_path_style,access_key=excluded.access_key,secret_key=excluded.secret_key",
          id,
          s.endpoint,
          s.region,
          s.bucket,
          s.prefix,
          Number(s.force_path_style),
          this.secrets.seal(s.access_key),
          this.secrets.seal(s.secret_key),
        );
        this.db.run(
          "UPDATE settings SET storage_enabled=1,storage_store_id=? WHERE id=1",
          id,
        );
      });
    });
  }
  namespace() {
    return this.db.get("SELECT vector_namespace FROM settings WHERE id=1")!
      .vector_namespace as string;
  }
  config(id: string): StorageConfig {
    const row = this.db.get("SELECT * FROM object_stores WHERE id=?", id);
    if (!row)
      throw new Failure(503, "The original storage settings are unavailable.");
    return {
      ...row,
      force_path_style: !!row.force_path_style,
      access_key: this.secrets.open(row.access_key),
      secret_key: this.secrets.open(row.secret_key),
    } as StorageConfig;
  }
  enabled() {
    return !!this.db.get("SELECT storage_enabled FROM settings WHERE id=1")!
      .storage_enabled;
  }
  async put(
    raw: Buffer,
    mime: string,
    kind: "uploads" | "knowledge",
  ): Promise<ObjectRef> {
    if (!this.enabled())
      throw new Failure(
        400,
        "Uploads are not available. Ask an admin to configure S3 object storage.",
      );
    const active = this.active();
    if (!active) throw new Failure(503, "S3 storage settings are missing.");
    const s = this.config(active.id),
      key = [s.prefix, this.namespace(), kind, randomBytes(16).toString("hex")]
        .filter(Boolean)
        .join("/"),
      client = this.factory(s);
    try {
      const result = await client.put(key, raw, mime);
      return {
        store_id: active.id,
        key,
        version_id: result.version_id,
        sha256: createHash("sha256").update(raw).digest("hex"),
        size: raw.length,
      };
    } catch {
      throw new Failure(
        502,
        "Cannot store the file. Check S3 access and retry.",
      );
    } finally {
      client.close();
    }
  }
  async get(ref: ObjectRef) {
    const client = this.factory(this.config(ref.store_id));
    try {
      const raw = await client.get(ref.key, ref.version_id);
      if (
        raw.length !== ref.size ||
        createHash("sha256").update(raw).digest("hex") !== ref.sha256
      )
        throw new Error("Integrity mismatch");
      return raw;
    } catch {
      throw new Failure(
        502,
        "Cannot read the original file from object storage.",
      );
    } finally {
      client.close();
    }
  }
  async delete(ref: ObjectRef) {
    const client = this.factory(this.config(ref.store_id));
    try {
      await client.delete(ref.key, ref.version_id);
    } catch {
      throw new Failure(
        502,
        "Cannot delete the original file from object storage. Retry later.",
      );
    } finally {
      client.close();
    }
  }
}
