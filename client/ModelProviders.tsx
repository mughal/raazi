import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { Field } from "./ui";
import type { Provider, ProvidersData } from "../shared/types";
export function ModelProviders({
  notify,
  refresh,
}: {
  notify: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState<ProvidersData | null>(null),
    [editing, setEditing] = useState<Provider | null>(null),
    [models, setModels] = useState(""),
    [found, setFound] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () =>
    setData(await api<ProvidersData>("/api/admin/providers"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      await refresh();
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(p: Provider | null) {
    setEditing(p);
    setModels(p?.models.join("\n") ?? "");
    setFound([]);
  }
  async function discover(p: Provider) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ models: string[] }>(
        "/api/admin/providers/" + p.id + "/discover",
        "POST",
      );
      edit(p);
      setFound(result.models);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const f = new FormData(formElement),
      v = (k: string) => String(f.get(k) ?? "");
    void act(async () => {
      await api(
        "/api/admin/providers" + (editing ? "/" + editing.id : ""),
        editing ? "PUT" : "POST",
        {
          name: v("name"),
          kind: v("kind"),
          base_url: v("base_url"),
          models: models
            .split(/\n|,/)
            .map((s) => s.trim())
            .filter(Boolean),
          api_key: v("api_key"),
          clear_api_key: f.has("clear_api_key"),
          enabled: f.has("enabled"),
          supports_images: f.has("supports_images"),
          purpose: v("purpose"),
        },
      );
      formElement.reset();
      edit(null);
    }, "Provider saved");
  }
  if (!data) return <p role="status">{error || "Loading providers…"}</p>;
  return (
    <div className="provider-settings">
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <section className="card">
        <h3>Providers and approved models</h3>
        <p>
          Add local or hosted endpoints. Discovery lists models; only the names
          you save become available to users.
        </p>
        {data.providers.map((p) => (
          <div className="provider-row" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <p className="help">
                {p.kind} · {p.enabled ? "Enabled" : "Disabled"} ·{" "}
                {p.models.length} approved model(s)
              </p>
            </div>
            <div className="form-actions">
              <button disabled={busy} onClick={() => edit(p)}>
                Edit {p.name}
              </button>
              <button disabled={busy} onClick={() => void discover(p)}>
                Discover models for {p.name}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("/api/admin/providers/" + p.id, "DELETE"),
                    "Provider deleted",
                  )
                }
              >
                Delete {p.name}
              </button>
            </div>
          </div>
        ))}
      </section>
      <form className="card" key={editing?.id ?? "new"} onSubmit={save}>
        <h3>{editing ? "Edit provider" : "Add provider"}</h3>
        <Field label="Provider name">
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={editing?.name ?? ""}
          />
        </Field>
        <Field label="Provider protocol">
          <select
            name="kind"
            defaultValue={editing?.kind ?? "openai-compatible"}
          >
            <option value="openai-compatible">
              OpenAI-compatible (local or hosted)
            </option>
            <option value="typesafe">TypeSafe Jev</option>
          </select>
        </Field>
        <Field label="Provider use">
          <select name="purpose" defaultValue={editing?.purpose ?? "chat"}>
            <option value="chat">Chat models</option>
            <option value="decision">Decision models only</option>
            <option value="both">Chat and decision models</option>
          </select>
        </Field>
        <Field label="Provider base URL">
          <input
            name="base_url"
            type="url"
            required
            defaultValue={editing?.base_url ?? ""}
            placeholder="http://localhost:1234/v1"
          />
        </Field>
        <p className="help">
          Include /v1 if your endpoint uses it. TypeSafe:
          https://api.typesafe.ai/v1. TypeSafe models are used only for
          decisions.
        </p>
        <Field label="Provider API key">
          <input
            name="api_key"
            type="password"
            autoComplete="new-password"
            placeholder={
              editing?.has_api_key
                ? "Saved — leave blank to keep"
                : "Optional for local endpoints"
            }
          />
        </Field>
        <label className="checkbox-label">
          <input name="clear_api_key" type="checkbox" />
          Remove saved provider key
        </label>
        <Field label="Approved model names">
          <textarea
            value={models}
            onChange={(e) => setModels(e.target.value)}
            placeholder="One model name per line"
          />
        </Field>
        {!!found.length && (
          <fieldset>
            <legend>Discovered models</legend>
            {found.map((name) => (
              <label className="checkbox-label" key={name}>
                <input
                  type="checkbox"
                  checked={models
                    .split(/\n|,/)
                    .map((s) => s.trim())
                    .includes(name)}
                  onChange={(e) => {
                    const names = models
                      .split(/\n|,/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    setModels(
                      (e.target.checked
                        ? [...names, name]
                        : names.filter((n) => n !== name)
                      ).join("\n"),
                    );
                  }}
                />
                {name}
              </label>
            ))}
          </fieldset>
        )}
        <label className="checkbox-label">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={editing?.enabled ?? true}
          />
          Enable provider
        </label>
        <label className="checkbox-label">
          <input
            name="supports_images"
            type="checkbox"
            defaultChecked={editing?.supports_images ?? false}
          />
          All approved chat models accept images
        </label>
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            {editing ? "Save provider" : "Add provider"}
          </button>
          {editing && (
            <button type="button" disabled={busy} onClick={() => edit(null)}>
              Cancel edit
            </button>
          )}
        </div>
      </form>
      <form
        className="card"
        key={JSON.stringify(data.routing)}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act(
            () =>
              api("/api/admin/routing", "PUT", {
                enabled: f.has("enabled"),
                provider_id: String(f.get("provider_id") ?? ""),
                model: String(f.get("model") ?? ""),
                threshold: Number(f.get("threshold")),
                default_model: String(f.get("default_model") ?? ""),
              }),
            "Decision routing saved",
          );
        }}
      >
        <h3>Decision routing</h3>
        <p>
          Enable the switch below the composer. The decision provider receives
          the question, recent messages, and filenames. It chooses an approved
          chat model and a direct answer, knowledge search, or clarification. No
          external actions are executed.
        </p>
        <label className="checkbox-label">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={data.routing.enabled}
          />
          Enable decision routing
        </label>
        <Field label="Decision provider">
          <select
            aria-label="Decision provider"
            name="provider_id"
            defaultValue={data.routing.provider_id}
          >
            <option value="">Choose provider</option>
            {data.providers
              .filter(
                (p) =>
                  p.enabled && (p.kind === "typesafe" || p.purpose !== "chat"),
              )
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Decision model name">
          <input
            name="model"
            defaultValue={data.routing.model}
            placeholder="jev-latest"
          />
          <small>Use an approved model name from the selected provider.</small>
        </Field>
        <Field label="Minimum decision confidence">
          <input
            name="threshold"
            type="number"
            min={0.5}
            max={1}
            step={0.01}
            required
            defaultValue={data.routing.threshold}
          />
        </Field>
        <Field label="Default chat model">
          <select
            name="default_model"
            defaultValue={data.routing.default_model}
          >
            <option value="">First available model</option>
            {data.models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="help">
          Low confidence asks for clarification. A service error preserves the
          chat. Local decision endpoints must return the documented JSON choice
          format.
        </p>
        <button className="primary" disabled={busy}>
          Save decision routing
        </button>
      </form>
    </div>
  );
}
