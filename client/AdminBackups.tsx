import { Icon } from "./ui";
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
  const complete = report.runs.filter((run) => run.status === "complete");
  const latest = complete[0];
  const size = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(1)} KB`;
  const date = (value: string) =>
    new Date(value).toLocaleString("en-GB", {
      timeZone: "Asia/Karachi",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <section className="backup-dashboard">
      <div className="backup-heading">
        <div>
          <span className="backup-eyebrow">WORKSPACE RECOVERY</span>
          <h2>Data backups</h2>
          <p>Protect your workspace and keep recovery files together.</p>
        </div>
        <button
          className="backup-primary"
          disabled={pending || report.busy || !report.storage_ready}
          onClick={() => void act(() => api("/api/admin/backups", "POST"))}
        >
          <Icon name="refresh" /> Back up now
        </button>
      </div>
      <div className="backup-summary">
        <div>
          <small>Last successful backup</small>
          <strong>{latest ? date(latest.created_at) : "No backup yet"}</strong>
          <span>
            {latest
              ? `${latest.files.length} files saved`
              : "Create your first backup"}
          </span>
        </div>
        <div>
          <small>Backups retained</small>
          <strong>
            {complete.length} <em>/ 7</em>
          </strong>
          <span>Manual and daily backups</span>
        </div>
        <div>
          <small>Daily schedule</small>
          <strong>
            {report.schedule.enabled ? report.schedule.time : "Not enabled"}
          </strong>
          <span>Asia/Karachi</span>
        </div>
      </div>
      {report.busy && (
        <div className="backup-progress" role="status">
          <Icon name="refresh" />
          {report.stage}
          <span>Changes are paused until this backup finishes.</span>
        </div>
      )}
      <details className="backup-notes">
        <summary>What is included & recovery guidance</summary>
        <p>
          SQLite, PostgreSQL dumps, the file catalogue and a manifest are saved
          in the storage bucket. Original uploads remain in their existing
          locations. Keep environment configuration, encryption/signing keys and
          storage credentials separately. These backups do not replace backups
          of original documents.
        </p>
      </details>
      {!report.postgres_databases && (
        <p className="notice">
          PostgreSQL is not configured. Only SQLite will be backed up.
        </p>
      )}
      {!report.storage_ready && (
        <p className="notice">Configure Storage before creating a backup.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="backup-controls">
        <form
          className="backup-panel"
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
          <button disabled={pending || report.busy}>
            Save backup schedule
          </button>
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
        <div className="backup-panel">
          <h3>File recovery catalogue</h3>
          <p>
            Export filenames, object paths, checksums and access labels. Write
            metadata for existing files, and refresh it after repository
            permission changes. Metadata remains private in the same bucket.
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
        </div>
      </div>
      <div className="backup-history-heading">
        <h3>Backup history</h3>
        <span>Click a backup to view its files</span>
      </div>
      {report.runs.length === 0 && <p>No backups yet.</p>}
      {report.runs.map((run) => (
        <details className="backup-run" key={run.id}>
          <summary>
            <span className={"backup-state backup-state-" + run.status}>
              {run.status === "complete"
                ? "Complete"
                : run.status.replaceAll("_", " ")}
            </span>
            <span className="backup-run-title">
              <strong>{date(run.created_at)}</strong>
              <small>
                {run.trigger === "daily" ? "Scheduled backup" : "Manual backup"}{" "}
                · Asia/Karachi
              </small>
            </span>
            <span className="backup-run-size">
              {run.files.length} files ·{" "}
              {size(run.files.reduce((total, file) => total + file.size, 0))}
            </span>
            <Icon name="chevron" />
          </summary>
          {run.error && (
            <p className="notice" role="alert">
              {run.error}
            </p>
          )}
          {run.files.map((file) => (
            <div className="backup-file" key={file.key}>
              <div>
                <strong>{file.key.split("/").at(-1)}</strong>
                <span>{size(file.size)}</span>
              </div>
              <code>{file.key}</code>
              <small>SHA-256: {file.sha256}</small>
            </div>
          ))}
          {run.status === "complete" && (
            <p className="backup-success">
              Backup files saved to object storage.
            </p>
          )}
        </details>
      ))}
    </section>
  );
}
