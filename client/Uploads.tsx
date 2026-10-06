import { useEffect, useState } from "react";
import type { Attachment } from "../shared/types";
import { api } from "./api";
import { Icon } from "./ui";
export function AttachmentChips({
  files,
  onRemove,
  onRetry,
  busy = false,
}: {
  files: Attachment[];
  onRemove?: (id: string) => void;
  onRetry?: (file: Attachment) => void;
  busy?: boolean;
}) {
  return files.length ? (
    <div className="attachment-list">
      {files.map((file) => (
        <div
          className={
            "attachment-chip " +
            (file.status === "ready" ? "attachment-ready" : "attachment-error")
          }
          key={file.id}
        >
          {file.kind === "image" ? (
            <img src={file.file_url} alt={file.filename} />
          ) : (
            <Icon name="book" />
          )}
          <div>
            <a href={file.file_url} target="_blank" rel="noopener noreferrer">
              {file.filename}
            </a>
            <small>
              {file.status === "ready"
                ? file.kind === "image"
                  ? "Ready · Image"
                  : file.search_mode === "vector"
                    ? "Ready · Private knowledge"
                    : "Ready · Text search"
                : file.status === "unsupported"
                  ? "Not readable"
                  : file.status === "failed"
                    ? "Indexing failed"
                    : file.status === "needs_reindex"
                      ? "Needs reindex"
                      : file.status.replaceAll("_", " ")}
            </small>
            {(file.error || file.warning) && (
              <small>{file.error || file.warning}</small>
            )}
          </div>
          {onRetry && ["failed", "needs_reindex"].includes(file.status) && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => onRetry(file)}
            >
              Retry
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="icon-button"
              aria-label={"Remove " + file.filename}
              disabled={busy}
              onClick={() => onRemove(file.id)}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      ))}
    </div>
  ) : null;
}
export function YourFiles({ onUse }: { onUse: (file: Attachment) => void }) {
  const [files, setFiles] = useState<Attachment[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () =>
    setFiles(await api<Attachment[]>("/api/attachments"));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function action(file: Attachment, remove: boolean) {
    if (remove && !confirm("Delete this file and its private knowledge?"))
      return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/api/attachments/" + file.id + (remove ? "" : "/reindex"),
        remove ? "DELETE" : "POST",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card your-files">
      <h3>Your files</h3>
      <p>
        Files uploaded in chat stay private. Delete files here when you no
        longer need them.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!files.length && <p>No files yet. Use the + button in chat.</p>}
      {files.map((file) => (
        <div className="row" key={file.id}>
          <div>
            <a href={file.file_url} target="_blank" rel="noopener noreferrer">
              {file.filename}
            </a>
            <small>
              {file.status.replaceAll("_", " ")} · {Math.ceil(file.size / 1024)}{" "}
              KB
            </small>
            {(file.error || file.warning) && (
              <small>{file.error || file.warning}</small>
            )}
          </div>
          <div className="document-actions">
            {file.status === "ready" && (
              <button disabled={busy} onClick={() => onUse(file)}>
                Use in chat
              </button>
            )}
            {file.kind === "document" && file.status !== "unsupported" && (
              <button disabled={busy} onClick={() => void action(file, false)}>
                Reindex
              </button>
            )}
            <button
              className="danger"
              disabled={busy}
              onClick={() => void action(file, true)}
            >
              Delete file
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
