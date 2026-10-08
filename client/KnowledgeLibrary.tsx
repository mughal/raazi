import { useEffect, useState } from "react";
import { api } from "./api";
import { Icon } from "./ui";
type Repository = {
  id: number;
  name: string;
  description: string;
  documents: number;
  ready: number;
  issues: number;
};
type Detail = {
  repository: Repository;
  documents: {
    id: number;
    title: string;
    filename: string;
    mime: string;
    status: string;
    sections: number;
    characters: number;
    preview: string;
    extraction_warning: number;
    index_completed: number;
    index_total: number;
  }[];
  page: number;
  pages: number;
  matching: number;
};
export function KnowledgeLibrary({
  userId,
  onChat,
}: {
  userId: string;
  onChat: (id: number) => void;
}) {
  const [repositories, setRepositories] = useState<Repository[]>([]),
    [selected, setSelected] = useState<number | null>(
      () => Number(sessionStorage.getItem("raazi-library:" + userId)) || null,
    ),
    [detail, setDetail] = useState<Detail | null>(null),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      api<Repository[]>("/api/library")
        .then((result) => {
          if (active) {
            setRepositories(result);
            setLoaded(true);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (selected)
      sessionStorage.setItem("raazi-library:" + userId, String(selected));
    else sessionStorage.removeItem("raazi-library:" + userId);
  }, [selected, userId]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const load = () =>
      api<Detail>(
        `/api/library/${selected}?page=${page}&search=${encodeURIComponent(search)}`,
      )
        .then((result) => {
          if (active) {
            setDetail(result);
            setError("");
          }
        })
        .catch((e) => {
          if (active) {
            setDetail(null);
            setError(e.message);
          }
        });
    const start = setTimeout(() => void load(), 200),
      timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [selected, page, search]);
  const status = (value: string) =>
    ({
      ready: "Ready",
      processing: "Indexing",
      needs_reindex: "Needs reindex",
      failed: "Needs attention",
    })[value] ?? "Not ready";
  return (
    <>
      <div className="eyebrow">YOUR ORGANIZATION'S KNOWLEDGE</div>
      <h1>Knowledge library</h1>
      <p className="page-subtitle">
        Explore the documents available to you, then choose a knowledge base for
        your questions.
      </p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {!loaded && !error && <p>Loading knowledge bases...</p>}
      {!selected && (
        <div className="grid">
          {repositories.map((repo) => (
            <section className="card library-repository" key={repo.id}>
              <Icon name="book" />
              <h2>{repo.name}</h2>
              <p>{repo.description || "No description has been added yet."}</p>
              <p className="help">
                {repo.documents}{" "}
                {repo.documents === 1 ? "document" : "documents"} · {repo.ready}{" "}
                ready
              </p>
              <div className="library-actions">
                <button
                  onClick={() => {
                    setSelected(repo.id);
                    setDetail(null);
                    setPage(1);
                    setSearch("");
                  }}
                >
                  View documents
                </button>
                <button onClick={() => onChat(repo.id)}>
                  Chat with this repository
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      {!selected && loaded && !repositories.length && (
        <section className="card">
          <h3>Your library is waiting</h3>
          <p>An administrator can add knowledge bases and give you access.</p>
        </section>
      )}
      {selected && (
        <>
          <button
            onClick={() => {
              setSelected(null);
              setError("");
            }}
          >
            Back to knowledge bases
          </button>
          {detail?.repository.id === selected ? (
            <section className="library-detail">
              <div className="backup-heading">
                <div>
                  <h2>{detail.repository.name}</h2>
                  <p>
                    {detail.repository.description ||
                      "No description has been added yet."}
                  </p>
                </div>
                <button onClick={() => onChat(selected)}>
                  Chat with this repository
                </button>
              </div>
              <div className="backup-summary">
                <div>
                  <small>Documents</small>
                  <strong>{detail.repository.documents}</strong>
                </div>
                <div>
                  <small>Ready for questions</small>
                  <strong>{detail.repository.ready}</strong>
                </div>
                <div>
                  <small>Knowledge base</small>
                  <strong>
                    {!detail.repository.documents
                      ? "Empty"
                      : detail.repository.ready === detail.repository.documents
                        ? "Ready"
                        : detail.repository.issues > 0
                          ? "Needs attention"
                          : "Updating"}
                  </strong>
                </div>
              </div>
              {detail.repository.ready < detail.repository.documents && (
                <p className="notice">
                  Some documents are not ready. Answers from this knowledge base
                  will wait until all documents are ready. An administrator can
                  check indexing or reindex documents.
                </p>
              )}
              <label>
                Find a document
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by title or filename"
                />
              </label>
              <p className="help">
                {detail.matching} matching documents. Open a document for a text
                preview and index details.
              </p>
              {detail.documents.map((doc) => (
                <details className="backup-run library-document" key={doc.id}>
                  <summary>
                    <Icon name="book" />
                    <span className="backup-run-title">
                      <strong>{doc.title || doc.filename}</strong>
                      <small>
                        {doc.filename || "Text document"} · {doc.sections}{" "}
                        stored sections
                      </small>
                    </span>
                    <span
                      className={
                        "backup-state " +
                        (doc.status === "ready"
                          ? "backup-state-complete"
                          : "backup-state-failed")
                      }
                    >
                      {status(doc.status)}
                    </span>
                    <Icon name="chevron" />
                  </summary>
                  <div className="library-preview">
                    <p className="help">
                      {doc.characters.toLocaleString()} extracted characters
                      {doc.status === "processing" && doc.index_total > 0
                        ? ` · ${doc.index_completed}/${doc.index_total} sections indexed`
                        : ""}
                    </p>
                    {doc.extraction_warning ? (
                      <p className="notice">
                        Some content could not be extracted. This document may
                        need review or OCR.
                      </p>
                    ) : null}
                    <h3>Text preview</h3>
                    <p className="pre">
                      {doc.preview || "No readable text is available yet."}
                    </p>
                    <small>
                      This is the beginning of the extracted text, not a
                      generated summary.
                    </small>
                  </div>
                </details>
              ))}
              {!detail.documents.length && (
                <p>
                  {search
                    ? "No documents match your search."
                    : "No documents have been added yet."}
                </p>
              )}
              {detail.pages > 1 && (
                <div className="library-actions">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous documents
                  </button>
                  <span>
                    Page {detail.page} of {detail.pages}
                  </span>
                  <button
                    disabled={page >= detail.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next documents
                  </button>
                </div>
              )}
            </section>
          ) : (
            !error && <p>Loading documents...</p>
          )}
        </>
      )}
    </>
  );
}
