import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import type { Workspace, Chat, Group, User, Attachment } from "../shared/types";
import { Icon } from "./ui";
import { DocumentHint } from "./DocumentHint";
import { createPortal } from "react-dom";
type Props = {
  platformName: string;
  workspace: Workspace;
  user: User;
  view: string;
  active: string | null;
  folder: string | null;
  repository: string;
  personalFile: string | null;
  busy: boolean;
  collapsed: boolean;
  mobile: boolean;
  toggle: () => void;
  closeMobile: () => void;
  newChat: (
    group?: string,
    repository?: number | null,
    file?: string | null,
  ) => void;
  openChat: (chat: Chat) => void;
  openView: (view: string) => void;
  editChat: (chat: Chat) => void;
  editGroup: (
    group: Group | null,
    repository?: number | null,
    file?: string | null,
  ) => void;
  collapseGroup: (group: Group) => void;
  moveChat: (chat: Chat, group: string | null) => void;
  deleteChat: (chat: Chat) => void;
  logout: () => void;
};
export function Sidebar(p: Props) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => {
    const dismiss = (e: globalThis.MouseEvent) => {
      if (!(e.target as Element).closest(".chat-actions, .chat-action-menu"))
        setMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("click", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try {
      return {
        ...Object.fromEntries(
          p.workspace.repositories.map((r) => ["repo:" + r.id, true]),
        ),
        ...Object.fromEntries(
          p.workspace.personal_files.map((f) => ["file:" + f.id, true]),
        ),
        ...JSON.parse(
          sessionStorage.getItem("raazi-sidebar:" + p.user.id) ?? "{}",
        ),
      };
    } catch {
      return {};
    }
  });
  useEffect(() => {
    sessionStorage.setItem(
      "raazi-sidebar:" + p.user.id,
      JSON.stringify(closed),
    );
  }, [closed, p.user.id]);
  useEffect(() => {
    if (p.repository)
      setClosed((s) => ({
        ...s,
        library: false,
        ["repo:" + p.repository]: false,
      }));
  }, [p.repository]);
  useEffect(() => {
    if (p.personalFile)
      setClosed((s) => ({
        ...s,
        library: false,
        personal: false,
        ["file:" + p.personalFile]: false,
      }));
  }, [p.personalFile]);
  const disclosure = (
    key: string,
    label: string,
    icon: string,
    hint?: ReactNode,
  ) => (
    <button
      className="section-toggle"
      aria-label={label}
      aria-expanded={!!query || !closed[key]}
      onClick={() => setClosed((s) => ({ ...s, [key]: !s[key] }))}
    >
      {hint ?? <Icon name={icon} />}
      <span>{label}</span>
      <span
        className={
          "folder-chevron" + (query || !closed[key] ? " expanded" : "")
        }
      >
        <Icon name="chevron" />
      </span>
    </button>
  );
  const w = p.workspace,
    visible = (c: Chat) => c.title.toLowerCase().includes(query.toLowerCase());
  const row = (c: Chat, nested = false) => (
    <div
      key={c.id}
      draggable={!p.busy}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-raazi-chat", c.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(c.id);
        setMenu(null);
      }}
      onDragEnd={() => {
        setDragging(null);
        setDropTarget(null);
      }}
      className={
        "history-row" +
        (p.active === c.id ? " selected" : "") +
        (nested ? " nested" : "")
      }
    >
      <button
        className="chat-link"
        onClick={() => p.openChat(c)}
        disabled={p.busy}
        title={c.title}
      >
        <Icon name={c.pinned ? "pin" : "chat"} />
        <span>{c.title}</span>
      </button>
      <div className="chat-actions">
        <button
          className="row-menu"
          aria-label={"Manage chat " + c.title}
          aria-haspopup="menu"
          aria-expanded={menu === c.id + ":" + nested}
          disabled={p.busy}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setMenuPosition({
              left: Math.max(8, box.right - 160),
              top: Math.min(box.bottom + 4, innerHeight - 150),
            });
            setMenu((m) =>
              m === c.id + ":" + nested ? null : c.id + ":" + nested,
            );
          }}
        >
          <Icon name="more" />
        </button>
        {menu === c.id + ":" + nested &&
          createPortal(
            <div
              className="chat-action-menu"
              style={menuPosition}
              role="menu"
              aria-label={"Actions for " + c.title}
            >
              <button
                autoFocus
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  p.editChat(c);
                }}
              >
                Move chat
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  p.editChat(c);
                }}
              >
                Edit chat
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenu(null);
                  p.deleteChat(c);
                }}
              >
                Delete chat
              </button>
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
  const dropEvents = (
    repo: number | null,
    file: string | null,
    group: string | null,
    key: string,
  ) => ({
    onDragOver: (e: DragEvent) => {
      const chat = w.conversations.find((c) => c.id === dragging);
      if (
        !p.busy &&
        chat &&
        (chat.repository_id ?? null) === repo &&
        (chat.personal_file_id ?? null) === file &&
        chat.group_id !== group
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setDropTarget(key);
      }
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node))
        setDropTarget(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      setDragging(null);
      const chat = w.conversations.find(
        (c) => c.id === e.dataTransfer.getData("application/x-raazi-chat"),
      );
      if (
        !p.busy &&
        chat &&
        (chat.repository_id ?? null) === repo &&
        (chat.personal_file_id ?? null) === file &&
        chat.group_id !== group
      )
        p.moveChat(chat, group);
    },
  });
  const pathSection = (
    repo: number | null,
    label: string,
    file: Attachment | null = null,
  ) => {
    const fileId = file?.id ?? null;
    const key = file
      ? "file:" + file.id
      : repo === null
        ? "general"
        : "repo:" + repo;
    const chats = w.conversations.filter(
      (c) =>
        (c.repository_id ?? null) === repo &&
        (c.personal_file_id ?? null) === fileId &&
        visible(c),
    );
    return (
      <section className="history-section path-section" key={key}>
        <div
          className={dropTarget === key ? "chat-drop-target" : ""}
          {...dropEvents(repo, fileId, null, key)}
        >
          {disclosure(
            key,
            label,
            repo === null ? "chat" : "folder",
            file ? (
              <DocumentHint label={label} file={file} />
            ) : repo != null ? (
              <DocumentHint label={label} repository={repo} />
            ) : undefined,
          )}
        </div>
        {(query || !closed[key]) && (
          <div className="path-children">
            <div className="path-actions">
              <button
                className="text-button"
                aria-label={
                  repo === null && !file
                    ? "New general chat"
                    : "New chat in " + label
                }
                disabled={p.busy}
                onClick={() => p.newChat(undefined, repo, fileId)}
              >
                <Icon name="plus" />
                {repo === null && !file
                  ? "New general chat"
                  : file
                    ? "Chat with file"
                    : "New chat in " + label}
              </button>
              <button
                className="icon-button"
                aria-label={
                  repo === null && !file
                    ? "Create folder"
                    : "Create folder in " + label
                }
                disabled={p.busy}
                onClick={() => p.editGroup(null, repo, fileId)}
              >
                <Icon name="folder" />
              </button>
            </div>
            {w.groups
              .filter(
                (g) =>
                  (g.repository_id ?? null) === repo &&
                  (g.personal_file_id ?? null) === fileId,
              )
              .map((g) => {
                const chats = w.conversations.filter(
                  (c) => c.group_id === g.id && visible(c),
                );
                return (
                  <div key={g.id}>
                    <div
                      {...dropEvents(repo, fileId, g.id, g.id)}
                      className={
                        "folder-row" +
                        (dropTarget === g.id ? " chat-drop-target" : "") +
                        (p.folder === g.id ? " current-folder" : "")
                      }
                    >
                      <button
                        className="folder-toggle"
                        aria-expanded={!!query || !g.collapsed}
                        onClick={() => p.collapseGroup(g)}
                      >
                        <span
                          className={
                            "folder-chevron" + (!g.collapsed ? " expanded" : "")
                          }
                        >
                          <Icon name="chevron" />
                        </span>
                        <Icon name="folder" />
                        <span>{g.name}</span>
                        <small>{chats.length}</small>
                      </button>
                      <button
                        className="row-menu"
                        aria-label={"Manage folder " + g.name}
                        onClick={() => p.editGroup(g)}
                      >
                        <Icon name="more" />
                      </button>
                    </div>
                    {(!g.collapsed || query) && (
                      <div className="folder-children">
                        {chats.map((c) => row(c, true))}
                        <button
                          className="text-button"
                          onClick={() => p.newChat(g.id, repo, fileId)}
                          disabled={p.busy}
                        >
                          <Icon name="plus" />
                          New chat in folder
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

            {chats.filter((c) => !c.group_id).map((c) => row(c, true))}
            {!chats.length && <p className="sidebar-hint">No chats yet.</p>}
          </div>
        )}
      </section>
    );
  };
  return (
    <>
      <nav className="rail" aria-label="Quick navigation">
        <button
          className="rail-home active"
          title="Chat"
          aria-label="Chat"
          onClick={() => p.openView("chat")}
        >
          <Icon name="home" />
        </button>
        <button
          title="Chat history"
          aria-label="Toggle chat history"
          onClick={p.toggle}
        >
          <Icon name="chat" />
        </button>
        <button
          title="Knowledge"
          aria-label="Knowledge"
          onClick={() => p.openView("knowledge")}
        >
          <Icon name="book" />
        </button>
        {p.user.role === "admin" && (
          <button
            title="Administration"
            aria-label="Administration"
            onClick={() => p.openView("admin")}
          >
            <Icon name="settings" />
          </button>
        )}
        <span className="rail-spacer" />
        <button title="Sign out" aria-label="Sign out" onClick={p.logout}>
          <Icon name="logout" />
        </button>
        <button
          title="Your profile"
          aria-label="Your profile"
          onClick={() => p.openView("profile")}
        >
          <span className="avatar">
            {p.user.name
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </span>
        </button>
      </nav>
      <button
        className="sidebar-backdrop"
        aria-label="Close sidebar"
        onClick={p.closeMobile}
      />
      <aside className="sidebar" aria-label="Chat history">
        <div className="sidebar-header">
          <div>
            <button
              className="workspace-brand"
              onClick={() => p.openView("chat")}
            >
              <img className="sngpl-logo" src="/sngpl-logo.png" alt="SNGPL" />
              {p.platformName}
            </button>
            <div className="workspace-caption">SNGPL ENTERPRISE WORKSPACE</div>
          </div>
          <button
            className="icon-button"
            aria-label="Collapse sidebar"
            onClick={p.toggle}
          >
            <Icon name="panel" />
          </button>
        </div>
        <button
          className="new-chat"
          onClick={() => p.newChat()}
          disabled={p.busy}
        >
          <Icon name="edit" />
          New chat
        </button>
        <div className="sidebar-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Search chats"
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="nav">
          {p.user.role === "admin" && (
            <button
              className={p.view === "admin" ? "active" : ""}
              onClick={() => p.openView("admin")}
            >
              <Icon name="settings" />
              Administration
            </button>
          )}
        </div>
        <div className="sidebar-scroll">
          {w.conversations.some((c) => c.pinned && visible(c)) && (
            <section className="history-section">
              {disclosure("pinned", "Pinned", "pin")}
              {(query || !closed.pinned) &&
                w.conversations
                  .filter((c) => c.pinned && visible(c))
                  .map((c) => row(c))}
            </section>
          )}
          <section className="history-section">
            {disclosure("library", "Knowledge library", "book")}
            {(query || !closed.library) && (
              <div className="library-children">
                <button
                  className="text-button"
                  onClick={() => p.openView("knowledge")}
                >
                  Browse documents
                </button>
                {w.repositories.map((r) => pathSection(r.id, r.name))}
                <section className="history-section personal-section">
                  {disclosure("personal", "Personal", "book")}
                  {(query || !closed.personal) && (
                    <div className="library-children">
                      {w.personal_files.map((file) =>
                        pathSection(null, file.filename, file),
                      )}
                      {!w.personal_files.length && (
                        <p className="sidebar-hint">
                          No personal files yet. Upload a file with + in chat.
                        </p>
                      )}
                    </div>
                  )}
                </section>
                {!w.repositories.length && (
                  <p className="sidebar-hint">No knowledge bases available.</p>
                )}
              </div>
            )}
          </section>
          {pathSection(null, "General chats")}
          {w.conversations.some(
            (c) =>
              c.repository_id != null &&
              !w.repositories.some((r) => r.id === c.repository_id),
          ) && (
            <section className="history-section">
              <div className="section-label">Unavailable knowledge bases</div>
              {w.conversations
                .filter(
                  (c) =>
                    c.repository_id != null &&
                    !w.repositories.some((r) => r.id === c.repository_id) &&
                    visible(c),
                )
                .map((c) => row(c))}
            </section>
          )}
          {w.conversations.some(
            (c) =>
              c.personal_file_id &&
              !w.personal_files.some((f) => f.id === c.personal_file_id),
          ) && (
            <section className="history-section">
              <div className="section-label">Unavailable personal files</div>
              {w.conversations
                .filter(
                  (c) =>
                    c.personal_file_id &&
                    !w.personal_files.some(
                      (f) => f.id === c.personal_file_id,
                    ) &&
                    visible(c),
                )
                .map((c) => row(c))}
            </section>
          )}
          {query && !w.conversations.some(visible) && (
            <p className="sidebar-hint">No matching chats.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="privacy-dot" />
          Private workspace ·{" "}
          {w.chat_storage === "postgres" ? "PostgreSQL" : "Local storage"}
        </div>
      </aside>
    </>
  );
}
