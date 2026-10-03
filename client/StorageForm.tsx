import { useState, FormEvent } from "react";
import type { StorageSettings } from "../shared/types";
import { api } from "./api";
import { Field } from "./ui";
export function StorageForm({
  settings,
  reload,
  notify,
}: {
  settings: StorageSettings;
  reload: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(settings.enabled),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const values = (form: HTMLFormElement) => {
    const data = new FormData(form);
    return {
      enabled: data.has("enabled"),
      endpoint: String(data.get("endpoint") ?? ""),
      region: String(data.get("region") ?? "us-east-1"),
      bucket: String(data.get("bucket") ?? ""),
      prefix: String(data.get("prefix") ?? ""),
      force_path_style: data.has("force_path_style"),
      access_key: String(data.get("access_key") ?? ""),
      secret_key: String(data.get("secret_key") ?? ""),
    };
  };
  async function run(form: HTMLFormElement, test: boolean) {
    if (!form.reportValidity()) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (test) {
        await api("/api/admin/storage/test", "POST", values(form));
        setResult(
          "Bucket test passed. Access, write, read, and delete are available.",
        );
      } else {
        await api("/api/admin/storage", "PUT", values(form));
        await reload();
        notify(
          enabled
            ? "Object storage saved. Uploads are available."
            : "Uploads are off.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="card"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        void run(e.currentTarget, false);
      }}
    >
      <h3>S3 object storage</h3>
      <p>
        Store original files in an S3-compatible bucket, such as Huawei
        OceanStor Pacific.
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable file uploads
      </label>
      <Field label="S3 endpoint">
        <input
          name="endpoint"
          type="url"
          required={enabled}
          defaultValue={settings.endpoint}
          placeholder="https://s3.internal.example"
        />
      </Field>
      <Field label="S3 bucket">
        <input
          name="bucket"
          required={enabled}
          defaultValue={settings.bucket}
        />
      </Field>
      <Field label="S3 region">
        <input name="region" required defaultValue={settings.region} />
      </Field>
      <Field label="Object prefix">
        <input name="prefix" defaultValue={settings.prefix} />
      </Field>
      <label className="checkbox-label">
        <input
          name="force_path_style"
          type="checkbox"
          defaultChecked={settings.force_path_style}
        />
        Use path-style bucket addresses
      </label>
      <p className="help">
        Start with path-style addresses for your internal endpoint. Use the
        region and address style required by your storage service.
      </p>
      <Field label="S3 access key">
        <input
          name="access_key"
          type="password"
          autoComplete="new-password"
          placeholder={
            settings.has_access_key
              ? "Saved. Leave blank to keep."
              : "Enter the access key."
          }
        />
      </Field>
      <Field label="S3 secret key">
        <input
          name="secret_key"
          type="password"
          autoComplete="new-password"
          placeholder={
            settings.has_secret_key
              ? "Saved. Leave blank to keep."
              : "Enter the secret key."
          }
        />
      </Field>
      <p className="help">
        A new endpoint requires both keys. A new bucket affects new uploads.
        Existing files stay in their original bucket.
      </p>
      <p className="help">
        The test creates a small object, reads it, then deletes it. Save runs
        the same test.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="success-note" role="status">
          {result}
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          disabled={busy || !enabled}
          onClick={(e) => void run(e.currentTarget.form!, true)}
        >
          {busy ? "Checking…" : "Test bucket"}
        </button>
        <button className="primary" disabled={busy}>
          Save storage settings
        </button>
      </div>
    </form>
  );
}
