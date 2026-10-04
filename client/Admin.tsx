import { useState, useEffect, FormEvent } from "react";
import type {
  AdminData,
  EmbeddingSettings,
  User,
  StorageSettings,
} from "../shared/types";
import { ModelProviders } from "./ModelProviders";
import { StorageForm } from "./StorageForm";
import { api } from "./api";
import { Field, Modal } from "./ui";
type Props = {
  notify: (message: string) => void;
  refresh: () => Promise<void>;
};
export function Admin({ notify, refresh }: Props) {
  const [tab, setTab] = useState("Models"),
    [data, setData] = useState<AdminData | null>(null),
    [embedding, setEmbedding] = useState<EmbeddingSettings | null>(null),
    [storage, setStorage] = useState<StorageSettings | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editUser, setEditUser] = useState<User | null>(null);
  async function load() {
    const [a, e, st] = await Promise.all([
      api<AdminData>("/api/admin"),
      api<EmbeddingSettings>("/api/admin/embeddings"),
      api<StorageSettings>("/api/admin/storage"),
    ]);
    setData(a);
    setEmbedding(e);
    setStorage(st);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function submit(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      await refresh();
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const form = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return new FormData(e.currentTarget);
  };
  const value = (f: FormData, key: string) => String(f.get(key) ?? "");
  if (!data || !embedding || !storage)
    return (
      <div className="page">
        <h1>Administration</h1>
        <p role="alert">{error || "Loading settings…"}</p>
      </div>
    );
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">WORKSPACE MANAGEMENT</div>
          <h1>Administration</h1>
          <p className="page-subtitle">
            Configure models, knowledge, and enterprise profiles.
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {[
          "Models",
          "Providers",
          "Embeddings",
          "Storage",
          "Knowledge",
          "Users",
          "Audit",
        ].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            className={tab === t ? "active" : ""}
            onClick={() => {
              setTab(t);
              setError("");
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {tab === "Providers" && (
        <ModelProviders notify={notify} refresh={refresh} />
      )}
      {tab === "Storage" && (
        <StorageForm
          key={JSON.stringify(storage)}
          settings={storage}
          reload={async () => {
            await load();
            await refresh();
          }}
          notify={notify}
        />
      )}
      {tab === "Models" && (
        <form
          className="card"
          key={JSON.stringify(data.settings)}
          onSubmit={(e) => {
            const f = form(e);
            void submit(
              () =>
                api("/api/admin/settings", "PUT", {
                  base_url: value(f, "base_url"),
                  model: value(f, "model"),
                  system_prompt: value(f, "system_prompt"),
                  api_key: value(f, "api_key"),
                  clear_api_key: f.has("clear_api_key"),
                  supports_images: f.has("supports_images"),
                }),
              "Model settings saved",
            );
          }}
        >
          <h3>Local language model</h3>
          <p>Use your organization's OpenAI-compatible inference endpoint.</p>
          <Field label="Model base URL">
            <input
              name="base_url"
              required
              type="url"
              defaultValue={data.settings.base_url}
              placeholder="http://localhost:1234/v1"
            />
          </Field>
          <Field label="Model name">
            <input name="model" required defaultValue={data.settings.model} />
          </Field>
          <Field label="Model API key">
            <input
              name="api_key"
              type="password"
              autoComplete="new-password"
              placeholder={
                data.settings.has_api_key
                  ? "Saved — leave blank to keep"
                  : "Optional"
              }
            />
          </Field>
          <label className="checkbox-label">
            <input type="checkbox" name="clear_api_key" />
            Remove saved key
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="supports_images"
              defaultChecked={!!data.settings.supports_images}
            />
            This model accepts image input
          </label>
          <p className="help">
            Enable this only for a model that accepts image_url content. Image
            knowledge indexing is not supported yet.
          </p>
          <Field label="System prompt">
            <textarea
              name="system_prompt"
              required
              defaultValue={data.settings.system_prompt}
            />
          </Field>
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              Save model settings
            </button>
          </div>
        </form>
      )}
      {tab === "Embeddings" && (
        <form
          className="card"
          key={JSON.stringify(embedding)}
          onSubmit={(e) => {
            const f = form(e);
            void submit(
              () =>
                api("/api/admin/embeddings", "PUT", {
                  enabled: f.has("enabled"),
                  base_url: value(f, "base_url"),
                  model: value(f, "model"),
                  dimensions: Number(f.get("dimensions")),
                  api_key: value(f, "api_key"),
                  clear_api_key: f.has("clear_api_key"),
                }),
              "Embedding settings saved",
            );
          }}
        >
          <h3>Semantic knowledge search</h3>
          <p>
            {embedding.backend === "postgres"
              ? "PostgreSQL with pgvector"
              : "Local exact vector search"}{" "}
            · Existing documents need reindexing when the model changes.
          </p>
          <label className="checkbox-label">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={embedding.enabled}
            />
            Use an embedding model
          </label>
          <Field label="Embedding base URL">
            <input
              name="base_url"
              type="url"
              defaultValue={embedding.base_url}
              placeholder="http://localhost:1234/v1"
            />
          </Field>
          <Field label="Embedding model">
            <input name="model" defaultValue={embedding.model} />
          </Field>
          <Field label="Vector dimensions">
            <input
              name="dimensions"
              type="number"
              min="1"
              max="2000"
              required
              defaultValue={embedding.dimensions}
            />
          </Field>
          <Field label="Embedding API key">
            <input
              name="api_key"
              type="password"
              autoComplete="new-password"
              placeholder={
                embedding.has_api_key
                  ? "Saved — leave blank to keep"
                  : "Optional"
              }
            />
          </Field>
          <label className="checkbox-label">
            <input name="clear_api_key" type="checkbox" />
            Remove saved embedding key
          </label>
          <p className="help">
            Saving tests the embedding connection. Disable embeddings to use
            keyword search.
          </p>
          <button className="primary" disabled={busy}>
            {busy ? "Testing connection…" : "Save embedding settings"}
          </button>
        </form>
      )}
      {tab === "Knowledge" && (
        <>
          <div className="grid">
            <form
              className="card"
              onSubmit={(e) => {
                const f = form(e),
                  target = e.currentTarget;
                void submit(async () => {
                  await api("/api/admin/repositories", "POST", {
                    name: value(f, "name"),
                    description: value(f, "description"),
                    groups: value(f, "groups")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                  target.reset();
                }, "Repository created");
              }}
            >
              <h3>Create repository</h3>
              <Field label="Repository name">
                <input name="name" required maxLength={150} />
              </Field>
              <Field label="Description">
                <input name="description" maxLength={1000} />
              </Field>
              <Field label="Allowed AD group IDs">
                <input name="groups" placeholder="Comma-separated group IDs" />
              </Field>
              <p className="help">
                Leave groups empty for all signed-in users. Use exact
                identity-provider group IDs.
              </p>
              <button className="primary" disabled={busy}>
                Create repository
              </button>
            </form>
            <form
              className="card"
              onSubmit={(e) => {
                const f = form(e),
                  target = e.currentTarget;
                void submit(async () => {
                  await api("/api/admin/documents/upload", "POST", f);
                  target.reset();
                }, "Document uploaded; check its indexing status below");
              }}
            >
              <h3>Upload a document</h3>
              <Field label="Upload repository">
                <select name="repository_id" required>
                  <option value="">Select a repository</option>
                  {data.repositories.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Document title">
                <input
                  name="title"
                  maxLength={200}
                  placeholder="Optional — uses the filename"
                />
              </Field>
              <Field label="Document file">
                <input
                  name="file"
                  type="file"
                  required
                  accept=".pdf,.docx,.txt,.md"
                />
              </Field>
              <p className="help">
                PDF, DOCX, UTF-8 text, and Markdown · up to 20 MB. Scanned PDFs
                need OCR first.
              </p>
              <button
                className="primary"
                disabled={busy || !data.repositories.length}
              >
                {busy ? "Processing…" : "Upload and index"}
              </button>
            </form>
          </div>
          <section className="card">
            <details>
              <summary>Add text directly</summary>
              <form
                onSubmit={(e) => {
                  const f = form(e),
                    target = e.currentTarget;
                  void submit(async () => {
                    await api("/api/admin/documents", "POST", {
                      repository_id: Number(f.get("repository_id")),
                      title: value(f, "title"),
                      content: value(f, "content"),
                    });
                    target.reset();
                  }, "Text document added");
                }}
              >
                <Field label="Text repository">
                  <select name="repository_id" required>
                    <option value="">Select a repository</option>
                    {data.repositories.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Text document title">
                  <input name="title" required maxLength={200} />
                </Field>
                <Field label="Document text">
                  <textarea name="content" required maxLength={500000} />
                </Field>
                <button
                  className="primary"
                  disabled={busy || !data.repositories.length}
                >
                  Add and index text
                </button>
              </form>
            </details>
          </section>
          <section className="card">
            <h3>Repositories</h3>
            {!data.repositories.length && <p>No knowledge repositories yet.</p>}
            {data.repositories.map((r) => (
              <div className="row" key={r.id}>
                <div>
                  <strong>{r.name}</strong>
                  <small>
                    {r.description || "Knowledge repository"} ·{" "}
                    {JSON.parse(r.groups_json).length
                      ? "Restricted groups"
                      : "All users"}
                  </small>
                </div>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Delete this repository and its documents?"))
                      void submit(
                        () => api("/api/admin/repositories/" + r.id, "DELETE"),
                        "Repository deleted",
                      );
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </section>
          <section className="card">
            <div className="page-header">
              <h3>Documents</h3>
              <button
                disabled={busy}
                onClick={() => void load().catch((e) => setError(e.message))}
              >
                Refresh status
              </button>
            </div>
            {!data.documents.length && <p>No uploaded documents yet.</p>}
            {data.documents.map((d) => (
              <div className="row" key={d.id}>
                <div>
                  <strong>{d.title}</strong>
                  <small>
                    {data.repositories.find((r) => r.id === d.repo_id)?.name} ·{" "}
                    {d.size.toLocaleString()} characters ·{" "}
                    <span className="index-status">
                      {d.status.replaceAll("_", " ")}
                    </span>
                  </small>
                  {d.warning && <small>{d.warning}</small>}
                  {d.error && <small className="index-error">{d.error}</small>}
                </div>
                <div className="document-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void submit(
                        () =>
                          api(
                            "/api/admin/documents/" + d.id + "/reindex",
                            "POST",
                          ),
                        "Document reindexed",
                      )
                    }
                  >
                    {d.status === "failed" ? "Retry" : "Reindex"}
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Delete this document?"))
                        void submit(
                          () => api("/api/admin/documents/" + d.id, "DELETE"),
                          "Document deleted",
                        );
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "Users" && (
        <section className="card">
          <h3>Enterprise users</h3>
          {data.users.map((u) => (
            <div className="row" key={u.id}>
              <div>
                <strong>{u.name}</strong>
                <small>
                  {u.email} · {u.role}
                  {u.disabled ? " · Disabled" : ""}
                </small>
              </div>
              <button onClick={() => setEditUser(u)}>Edit profile</button>
            </div>
          ))}
        </section>
      )}
      {tab === "Audit" && (
        <section className="card">
          <h3>Recent administration activity</h3>
          {data.audit.length ? (
            data.audit.map((a, n) => (
              <div className="row" key={n}>
                <div>
                  <strong>{a.action}</strong>
                  <small>{a.user_id}</small>
                </div>
                <small>{a.created_at}</small>
              </div>
            ))
          ) : (
            <p>No activity yet.</p>
          )}
        </section>
      )}
      {editUser && (
        <Modal
          title={"Edit " + editUser.name}
          onClose={() => setEditUser(null)}
        >
          <form
            onSubmit={(e) => {
              const f = form(e);
              void submit(async () => {
                await api(
                  "/api/admin/users/" + encodeURIComponent(editUser.id),
                  "PUT",
                  {
                    department: value(f, "department"),
                    job_title: value(f, "job_title"),
                    profile: value(f, "profile"),
                    disabled: f.has("disabled"),
                  },
                );
                setEditUser(null);
              }, "Profile updated");
            }}
          >
            <Field label="Department">
              <input name="department" defaultValue={editUser.department} />
            </Field>
            <Field label="Job title">
              <input name="job_title" defaultValue={editUser.job_title} />
            </Field>
            <Field label="Enterprise context">
              <textarea name="profile" defaultValue={editUser.profile} />
            </Field>
            <label className="checkbox-label">
              <input
                name="disabled"
                type="checkbox"
                defaultChecked={!!editUser.disabled}
              />
              Disable account
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={() => setEditUser(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Save profile
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
