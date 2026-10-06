import { useState } from "react";
import type { Workspace, Chat, Group, User } from "../shared/types";
import { Icon } from "./ui";
type Props = {
  platformName: string;
  workspace: Workspace;
  user: User;
  view: string;
  active: string | null;
  folder: string | null;
  busy: boolean;
  collapsed: boolean;
  mobile: boolean;
  toggle: () => void;
  closeMobile: () => void;
  newChat: (group?: string) => void;
  openChat: (chat: Chat) => void;
  openView: (view: string) => void;
  editChat: (chat: Chat) => void;
  editGroup: (group: Group | null) => void;
  collapseGroup: (group: Group) => void;
  logout: () => void;
};
export function Sidebar(p: Props) {
  const [query, setQuery] = useState("");
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
  const dated = (c: Chat) => {
    const days =
      (new Date().setHours(0, 0, 0, 0) -
        new Date(c.updated_at).setHours(0, 0, 0, 0)) /
      86400000;
    return days < 1
      ? "Today"
      : days < 2
        ? "Yesterday"
        : days < 7
          ? "Previous 7 days"
          : "Older chats";
  };
  const ungrouped = w.conversations.filter(
    (c) => !c.group_id && !c.pinned && visible(c),
  );
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
          <button
            className={p.view === "knowledge" ? "active" : ""}
            onClick={() => p.openView("knowledge")}
          >
            <Icon name="book" />
            Knowledge library
          </button>
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
          <section className="history-section">
            <div className="section-label">Pinned</div>
            {w.conversations
              .filter((c) => c.pinned && visible(c))
              .map((c) => row(c))}
            {!w.conversations.some((c) => c.pinned) && (
              <p className="sidebar-hint">
                Keep important conversations close.
              </p>
            )}
          </section>
          <section className="history-section">
            <div className="section-heading">
              <span className="section-label">Folders</span>
              <button
                className="icon-button"
                aria-label="Create folder"
                onClick={() => p.editGroup(null)}
                disabled={p.busy}
              >
                <Icon name="plus" />
              </button>
            </div>
            {w.groups.map((g) => {
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
                        onClick={() => p.newChat(g.id)}
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
            {!w.groups.length && (
              <p className="sidebar-hint">Organize chats into folders.</p>
            )}
          </section>
          {["Today", "Yesterday", "Previous 7 days", "Older chats"].map(
            (label) => {
              const chats = ungrouped.filter((c) => dated(c) === label);
              return chats.length ? (
                <section className="history-section" key={label}>
                  <div className="section-label">{label}</div>
                  {chats.map((c) => row(c))}
                </section>
              ) : null;
            },
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
