import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment } from "../shared/types";
import { api } from "./api";
import { Icon } from "./ui";

type Detail = {
  repository: { description: string; documents: number; ready: number };
  documents: {
    id: number;
    title: string;
    filename: string;
    status: string;
    sections: number;
  }[];
};

export function DocumentHint({
  label,
  repository,
  file,
}: {
  label: string;
  repository?: number;
  file?: Attachment;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const hide = () => {
    keepOpen();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(
    () => () => {
      keepOpen();
      request.current++;
    },
    [],
  );
  const show = () => {
    keepOpen();
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.min(box.right + 12, Math.max(8, innerWidth - 340)),
      top: Math.max(8, Math.min(box.top, innerHeight - 270)),
    });
    setOpen(true);
    if (repository) {
      const sequence = ++request.current;
      setError("");
      void api<Detail>("/api/library/" + repository)
        .then((d) => {
          if (sequence === request.current) setDetail(d);
        })
        .catch((e) => {
          if (sequence === request.current) {
            setDetail(null);
            setError(e.message);
          }
        });
    }
  };
  return (
    <span
      className="document-hint-anchor"
      ref={anchor}
      tabIndex={0}
      aria-label={"Document details for " + label}
      aria-describedby={open ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Icon name={file ? "book" : "folder"} />
      {open &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="document-hint"
            style={position}
            onMouseEnter={keepOpen}
            onMouseLeave={hide}
          >
            <strong>{label}</strong>
            {file ? (
              <>
                <p>{file.filename}</p>
                <p>
                  {file.status.replaceAll("_", " ")} ·{" "}
                  {Math.ceil(file.size / 1024)} KB · {file.mime}
                </p>
                <p>
                  Uploaded{" "}
                  {new Date(file.created_at).toLocaleDateString("en-GB", {
                    timeZone: "Asia/Karachi",
                  })}
                </p>
                {(file.warning || file.error) && (
                  <p>{file.warning || file.error}</p>
                )}
              </>
            ) : error ? (
              <p>{error}</p>
            ) : detail ? (
              <>
                {detail.repository.description && (
                  <p>{detail.repository.description}</p>
                )}
                <p>
                  {detail.repository.documents}{" "}
                  {detail.repository.documents === 1 ? "document" : "documents"}{" "}
                  · {detail.repository.ready} ready
                </p>
                <ul>
                  {detail.documents.slice(0, 8).map((d) => (
                    <li key={d.id}>
                      <strong>{d.title || d.filename}</strong>
                      <span>
                        {d.filename} · {d.status.replaceAll("_", " ")} ·{" "}
                        {d.sections} sections
                      </span>
                    </li>
                  ))}
                </ul>
                {!detail.repository.documents && <p>No documents yet.</p>}
                {detail.repository.documents > 8 && (
                  <p>Open Browse documents to view all documents.</p>
                )}
              </>
            ) : (
              <p>Loading document details…</p>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
