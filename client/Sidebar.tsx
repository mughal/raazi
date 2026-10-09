import { useEffect, useState } from "react";
import type { Workspace, Chat, Group, User } from "../shared/types";
import { Icon } from "./ui";
type Props = {
  platformName: string;
  workspace: Workspace;
  user: User;
  view: string;
  active: string | null;
  folder: string | null;
  repository: string;
  busy: boolean;
  collapsed: boolean;
  mobile: boolean;
  toggle: () => void;
  closeMobile: () => void;
  newChat: (group?: string, repository?: number | null) => void;
  openChat: (chat: Chat) => void;
  openView: (view: string) => void;
  editChat: (chat: Chat) => void;
  editGroup: (group: Group | null, repository?: number | null) => void;
  collapseGroup: (group: Group) => void;
  logout: () => void;
};
export function Sidebar(p: Props) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try {
      return {
        ...Object.fromEntries(
          p.workspace.repositories.map((r) => ["repo:" + r.id, true]),
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
  const disclosure = (key: string, label: string, icon: string) => (
    <button
      className="section-toggle"
      aria-expanded={!!query || !closed[key]}
      onClick={() => setClosed((s) => ({ ...s, [key]: !s[key] }))}
    >
      <Icon name={icon} />
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
      <button
        className="row-menu"
        aria-label={"Manage chat " + c.title}
        onClick={() => p.editChat(c)}
        disabled={p.busy}
      >
        <Icon name="more" />
      </button>
    </div>
  );
  const pathSection = (repo: number | null, label: string) => {
    const key = repo === null ? "general" : "repo:" + repo;
    const chats = w.conversations.filter(
      (c) => (c.repository_id ?? null) === repo && visible(c),
    );
    return (
      <section className="history-section path-section" key={key}>
        {disclosure(key, label, repo === null ? "chat" : "folder")}
        {(query || !closed[key]) && (
          <div className="path-children">
            <div className="path-actions">
              <button
                className="text-button"
                disabled={p.busy}
                onClick={() => p.newChat(undefined, repo)}
              >
                <Icon name="plus" />
                {repo === null ? "New general chat" : "New chat in " + label}
              </button>
              <button
                className="icon-button"
                aria-label={
                  repo === null ? "Create folder" : "Create folder in " + label
                }
                disabled={p.busy}
                onClick={() => p.editGroup(null, repo)}
              >
                <Icon name="folder" />
              </button>
            </div>
            {w.groups
              .filter((g) => (g.repository_id ?? null) === repo)
              .map((g) => {
                const chats = w.conversations.filter(
                  (c) => c.group_id === g.id && visible(c),
                );
                return (
                  <div key={g.id}>
                    <div
                      className={
                        "folder-row" +
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
                          onClick={() => p.newChat(g.id, repo)}
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
