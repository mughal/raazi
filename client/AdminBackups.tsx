import { useEffect, useState } from "react";
import { api } from "./api";
type Report = {
  busy: boolean;
  stage: string;
  storage_ready: boolean;
  postgres_databases: number;
  schedule: {
    enabled: number;
    time: string;
    next_run: string | null;
    last_success_id: string;
  };
  runs: {
    id: string;
    created_at: string;
    status: string;
    trigger: string;
    error: string;
    files: { key: string; size: number; sha256: string }[];
  }[];
};
export function AdminBackups() {
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [metadataResult, setMetadataResult] = useState("");
  async function load() {
    setReport(await api<Report>("/api/admin/backups"));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void load().catch((e) => setError(e.message));
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  async function act(fn: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  if (!report) return <p>Loading backups...</p>;
  return (
    <section className="card usage-dashboard">
      <h2>Data backups</h2>
      <p>
        Save SQLite, PostgreSQL dumps and a manifest under the storage bucket's
        backups folder. Keep the latest seven completed backups, including
        manual backups. Original uploads remain in their existing bucket
        locations.
      </p>
      <p className="help">
        Keep ENCRYPTION_KEY, SECRET_KEY, environment configuration and storage
        credentials in a separate secure location. They are required for restore
        and are not copied into these backups. Application changes pause while a
        backup runs. These backups do not replace backups of original documents.
      </p>
      {!report.postgres_databases && (
        <p className="notice">
          PostgreSQL is not configured. Only SQLite will be backed up.
        </p>
      )}
      {!report.storage_ready && (
        <p className="notice">Configure Storage before creating a backup.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        disabled={pending || report.busy || !report.storage_ready}
        onClick={() => void act(() => api("/api/admin/backups", "POST"))}
      >
        Back up now
      </button>
      {report.busy && <p role="status">{report.stage}</p>}
      <form
        key={
          report.schedule.time +
          report.schedule.enabled +
          report.schedule.last_success_id
        }
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act(() =>
            api("/api/admin/backups/schedule", "PUT", {
              enabled: f.has("enabled"),
              time: String(f.get("time")),
            }),
          );
        }}
      >
        <h3>Daily schedule</h3>
        <p className="help">
          Create a manual backup first. Once its files are saved successfully,
          enable daily backups. The app must be running; a missed backup runs
          when the app returns.
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={!!report.schedule.enabled}
            disabled={!report.schedule.last_success_id}
          />{" "}
          Enable daily backups
        </label>
        <label>
          Daily time (Asia/Karachi)
          <input
            type="time"
            name="time"
            required
            defaultValue={report.schedule.time}
          />
        </label>
        <button disabled={pending || report.busy}>Save backup schedule</button>
        {report.schedule.next_run && (
          <p>
            Next backup:{" "}
            {new Date(report.schedule.next_run).toLocaleString("en-GB", {
              timeZone: "Asia/Karachi",
            })}{" "}
            (Asia/Karachi)
          </p>
        )}
      </form>
      <h3>File recovery catalogue</h3>
      <p>
        Export filenames, object paths, checksums and access labels. Write
        metadata for existing files, and refresh it after repository permission
        changes. Metadata remains private in the same bucket.
      </p>
      <button
        disabled={pending || report.busy}
        onClick={() =>
          void act(async () => {
            const result = await api<{ saved: number; failed: number }>(
              "/api/admin/storage/metadata",
              "POST",
            );
            setMetadataResult(
              `${result.saved} file metadata records written; ${result.failed} failed.`,
            );
            if (result.failed)
              throw new Error(
                `${result.failed} files could not be updated. ${result.saved} files updated. Retry later.`,
              );
          })
        }
      >
        Write file metadata
      </button>
      <button
        disabled={pending}
        onClick={() =>
          void act(async () => {
            const data = await api("/api/admin/storage/catalogue");
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "raazi-file-catalogue.json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })
        }
      >
        Export file catalogue
      </button>
      {metadataResult && <p role="status">{metadataResult}</p>}
      <h3>Backup history</h3>
      {report.runs.length === 0 && <p>No backups yet.</p>}
      {report.runs.map((run) => (
        <div className="card" key={run.id}>
          <strong>
            {new Date(run.created_at).toLocaleString()} · {run.trigger} ·{" "}
            {run.status.replaceAll("_", " ")}
          </strong>
          {run.error && <p role="alert">{run.error}</p>}
          {run.files.map((file) => (
            <p className="help" key={file.key}>
              {file.key} · {(file.size / 1024).toFixed(1)} KB
            </p>
          ))}
          {run.status === "complete" && (
            <p>Backup files saved to object storage.</p>
          )}
        </div>
      ))}
    </section>
  );
}
