import { StrictMode, useEffect, useRef, useState, FormEvent } from "react";
import { PortalLogin } from "./PortalLogin";
import { createRoot } from "react-dom/client";
import type {
  Session,
  Workspace,
  Chat,
  Group,
  Message,
  Source,
  Attachment,
} from "../shared/types";
import { api, setCSRF } from "./api";
import { MessageView } from "./MessageView";
import { PaletteSettings } from "./PaletteSettings";
import { Sidebar } from "./Sidebar";
import { AttachmentChips, YourFiles } from "./Uploads";
import { Admin } from "./Admin";
import { Modal, Field, Icon } from "./ui";
import "./style.css";
type Editor =
  { kind: "chat"; chat: Chat } | { kind: "group"; group: Group | null };
function SourceView({ id }: { id: string }) {
  const [source, setSource] = useState<
      (Source & { warning: string; file_url: string | null }) | null
    >(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Source & { warning: string; file_url: string | null }>(
      "/api/sources/" + id,
    )
      .then(setSource)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <div className="page source-view">
      <a href="/">← Back to Raazi</a>
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : source ? (
        <>
          <div className="eyebrow">KNOWLEDGE SOURCE</div>
          <h1>{source.title}</h1>
          <p className="page-subtitle">
            {source.filename} · {source.label}
          </p>
          {source.warning && <p className="notice">{source.warning}</p>}
          {source.file_url && (
            <a
              className="source-original"
              href={source.file_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {source.page
                ? "Open original PDF at page " + source.page
                : "Download original document"}
            </a>
          )}
          <p id="source-excerpt" className="pre">
            {source.content}
          </p>
        </>
      ) : (
        <p>Loading source…</p>
      )}
    </div>
  );
}
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [view, setView] = useState("chat"),
    [cid, setCid] = useState<string | null>(null),
    [folder, setFolder] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [draftFiles, setDraftFiles] = useState<Record<string, Attachment[]>>({}),
    [busyText, setBusyText] = useState("Raazi is thinking…"),
    [repository, setRepository] = useState(""),
    [modelKey, setModelKey] = useState(""),
    [useDecision, setUseDecision] = useState(false),
    [thinking, setThinking] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [editor, setEditor] = useState<Editor | null>(null),
    [dialogError, setDialogError] = useState("");
  const chatScroll = useRef<HTMLDivElement>(null),
    end = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    loadSequence = useRef(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    draftKey = cid ?? "new:" + (folder ?? ""),
    draft = drafts[draftKey] ?? "",
    files = draftFiles[draftKey] ?? [];
  const setDraft = (value: string) =>
    setDrafts((d) => ({ ...d, [draftKey]: value }));
  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  };
  async function refresh() {
    setWorkspace(await api<Workspace>("/api/workspace"));
  }
  async function loadSession() {
    const s = await api<Session>("/api/session");
    setCSRF(s.csrf);
    setSession(s);
    if (s.user) await refresh();
    else setWorkspace(null);
  }
  useEffect(() => {
    document.documentElement.dataset.palette =
      session?.user?.palette ?? "forest";
    document.documentElement.dataset.composerShade =
      session?.user?.composer_shade ?? "mist";
    document.documentElement.dataset.composerSize =
      session?.user?.composer_size ?? "compact";
  }, [
    session?.user?.palette,
    session?.user?.composer_shade,
    session?.user?.composer_size,
  ]);
  useEffect(() => {
    loadSession().catch((e) => setError(e.message));
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    const panel = chatScroll.current;
    if (panel)
      panel.scrollTo({
        top: messages.length ? panel.scrollHeight : 0,
        behavior: "smooth",
      });
  }, [messages, busy, view]);
  async function perform(
    fn: () => Promise<void>,
    label = "Raazi is thinking…",
  ) {
    setBusyText(label);
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const openView = (name: string) => {
    if (busy) return;
    setView(name);
    setMobile(false);
  };
  const newChat = (group?: string) => {
    if (busy) return;
    loadSequence.current++;
    setCid(null);
    setFolder(group ?? null);
    setMessages([]);
    setView("chat");
    setMobile(false);
    setError("");
  };
  async function openChat(chat: Chat) {
    if (busy) return;
    const sequence = ++loadSequence.current;
    setError("");
    try {
      const m = await api<Message[]>("/api/conversations/" + chat.id);
      if (sequence !== loadSequence.current) return;
      setMessages(m);
      setCid(chat.id);
      setFolder(chat.group_id);
      setView("chat");
      setMobile(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function uploadFiles(selected: FileList | null) {
    if (!selected?.length || busy) return;
    if (files.length + selected.length > 5) {
      setError("Use at most five files in one message.");
      return;
    }
    await perform(async () => {
      for (const file of Array.from(selected)) {
        const form = new FormData();
        form.append("file", file);
        const uploaded = await api<Attachment>(
          "/api/attachments",
          "POST",
          form,
        );
        setDraftFiles((d) => ({
          ...d,
          [draftKey]: [...(d[draftKey] ?? []), uploaded],
        }));
      }
    }, "Upload and index files…");
  }
  async function retryFile(file: Attachment) {
    await perform(async () => {
      const updated = await api<Attachment>(
        "/api/attachments/" + file.id + "/reindex",
        "POST",
      );
      setDraftFiles((d) => ({
        ...d,
        [draftKey]: (d[draftKey] ?? []).map((f) =>
          f.id === updated.id ? updated : f,
        ),
      }));
    }, "Reindex file…");
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || busy || files.some((f) => f.status !== "ready"))
      return;
    const prompt = draft,
      submittedFiles = files;
    await perform(async () => {
      const result = await api<{
        conversation_id: string;
        content: string;
        sources: Source[];
      }>("/api/chat", "POST", {
        message: prompt,
        conversation_id: cid ?? "",
        group_id: folder,
        repository_id: repository ? Number(repository) : null,
        attachment_ids: submittedFiles.map((f) => f.id),
        model_key: modelKey || undefined,
        use_decision: useDecision && !!workspace?.routing_enabled,
        thinking,
      });
      setMessages(
        await api<Message[]>("/api/conversations/" + result.conversation_id),
      );
      setDrafts((d) => ({
        ...d,
        [draftKey]: "",
        [result.conversation_id]: "",
      }));
      setDraftFiles((d) => ({
        ...d,
        [draftKey]: [],
        [result.conversation_id]: [],
      }));
      setCid(result.conversation_id);
      await refresh();
    });
  }
  async function resendQuestion(
    message: Message,
    prompt: string,
  ): Promise<boolean> {
    if (busy || !cid || !prompt.trim() || message.id == null) return false;
    let completed = false;
    await perform(async () => {
      const attached =
        typeof message.attachments === "string"
          ? JSON.parse(message.attachments)
          : (message.attachments ?? []);
      await api("/api/chat", "POST", {
        conversation_id: cid,
        message: prompt,
        edit_message_id: String(message.id),
        repository_id: repository ? Number(repository) : null,
        attachment_ids: attached.map((f: Attachment) => f.id),
        model_key: modelKey || undefined,
        use_decision: useDecision && !!workspace?.routing_enabled,
        thinking,
      });
      setMessages(await api<Message[]>("/api/conversations/" + cid));
      await refresh();
      completed = true;
    });
    return completed;
  }
  const sourceId = /^\/sources\/([a-f0-9]{32})$/.exec(location.pathname)?.[1];
  if (!session)
    return <div className="loading">{error || "Loading Raazi…"}</div>;
  if (!session.user)
    return (
      <div className="login">
        <div className="card">
          <div className="brand">
            <img
              className="sngpl-logo login-logo"
              src="/sngpl-logo.png"
              alt="SNGPL"
            />
            Raazi <small>ENTERPRISE</small>
          </div>
          <h1>
            Your knowledge.
            <br />
            One conversation.
          </h1>
          <p>Work with your local models and trusted enterprise knowledge.</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {session.development ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api("/auth/development", "POST");
                  await loadSession();
                })
              }
            >
              Continue as local administrator
            </button>
          ) : session.auth_mode === "portal" ? (
            <PortalLogin onLogin={loadSession} />
          ) : (
            <a className="primary" href="/auth/login">
              Sign in with your work account
            </a>
          )}
          <p className="help">
            {session.development
              ? "Local development environment"
              : "Secure enterprise sign-in"}
          </p>
        </div>
      </div>
    );
  if (sourceId) return <SourceView id={sourceId} />;
  if (!workspace)
    return <div className="loading">{error || "Loading workspace…"}</div>;
  const chosenModel =
    workspace.models.find(
      (m) => m.key === (modelKey || workspace.default_model),
    ) ?? workspace.models[0];
  const canThink =
    useDecision && workspace.routing_enabled
      ? workspace.models.some((m) => m.supports_thinking)
      : !!chosenModel?.supports_thinking;
  const current = workspace.conversations.find((c) => c.id === cid),
    currentFolder = workspace.groups.find((g) => g.id === folder);
  const editChat = (chat: Chat) => {
      setDialogError("");
      setEditor({ kind: "chat", chat });
    },
    editGroup = (group: Group | null) => {
      setDialogError("");
      setEditor({ kind: "group", group });
    };
  async function editorAction(action: () => Promise<unknown>) {
    setBusy(true);
    setDialogError("");
    try {
      await action();
      await refresh();
      setEditor(null);
    } catch (e) {
      setDialogError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={
        "layout" +
        (collapsed ? " sidebar-collapsed" : "") +
        (mobile ? " mobile-open" : "")
      }
    >
      <Sidebar
        workspace={workspace}
        user={session.user}
        view={view}
        active={cid}
        folder={folder}
        busy={busy}
        collapsed={collapsed}
        mobile={mobile}
        toggle={() => {
          if (innerWidth <= 760) setMobile((v) => !v);
          else setCollapsed((v) => !v);
        }}
        closeMobile={() => setMobile(false)}
        newChat={newChat}
        openChat={(c) => void openChat(c)}
        openView={openView}
        editChat={editChat}
        editGroup={editGroup}
        collapseGroup={(g) =>
          void perform(async () => {
            await api("/api/chat-groups/" + g.id, "PATCH", {
              collapsed: !g.collapsed,
            });
            await refresh();
          })
        }
        logout={() =>
          void perform(async () => {
            await api("/auth/logout", "POST");
            await loadSession();
            setMessages([]);
            setCid(null);
            setDrafts({});
            setDraftFiles({});
          })
        }
      />
      <main className={"main" + (view === "chat" ? " main-chat" : "")}>
        <header className="topbar">
          <div className="topbar-title">
            <button
              id="open-sidebar"
              className="icon-button"
              aria-label="Open sidebar"
              onClick={() => {
                setCollapsed(false);
                setMobile(true);
              }}
            >
              <Icon name="panel" />
            </button>
            <div>
              <strong>
                {view === "chat"
                  ? (current?.title ?? "New conversation")
                  : view === "admin"
                    ? "Administration"
                    : view === "knowledge"
                      ? "Knowledge library"
                      : "Your profile"}
              </strong>
              <span className="topbar-context">
                {view === "chat"
                  ? (currentFolder?.name ?? "Your private workspace")
                  : "Raazi enterprise workspace"}
              </span>
            </div>
          </div>
          <span className="badge">
            <span className="dot">●</span>
            {workspace.demo_mode
              ? "Demo mode"
              : chosenModel?.label || "Configure a local model"}
          </span>
        </header>
        {error && (
          <div className="notice global-error" role="alert">
            {error}
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {view === "chat" && (
          <div className="chat-wrap">
            <div
              className="chat-scroll"
              ref={chatScroll}
              role="region"
              aria-label="Chat messages"
              tabIndex={0}
            >
              {!messages.length ? (
                <section className="welcome">
                  <img
                    className="sngpl-logo welcome-logo"
                    src="/sngpl-logo.png"
                    alt=""
                  />
                  <div className="eyebrow">CONNECTED TO YOUR WORK</div>
                  <h1>How can I help, {session.user.name.split(" ")[0]}?</h1>
                  <p className="subtitle">
                    A thoughtful space for your questions, ideas, and enterprise
                    knowledge. Powered by your organization's local models.
                  </p>
                  <div className="suggestions">
                    {[
                      {
                        icon: "book",
                        title: "Explore your knowledge",
                        text: "Find answers across your documents",
                        prompt: "What can you tell me about our policies?",
                      },
                      {
                        icon: "edit",
                        title: "Make work clearer",
                        text: "Summarize, draft, and refine",
                        prompt: "Help me draft a clear project update.",
                      },
                      {
                        icon: "chat",
                        title: "Think it through",
                        text: "Turn your next idea into a plan",
                        prompt: "Help me plan my next project.",
                      },
                    ].map((s) => (
                      <button
                        key={s.title}
                        className="suggestion"
                        onClick={() => setDraft(s.prompt)}
                      >
                        <span className="icon">
                          <Icon name={s.icon} />
                        </span>
                        <strong>{s.title}</strong>
                        <small>{s.text}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="messages">
                  {current && (
                    <div className="chat-actions">
                      <button
                        className="text-button"
                        onClick={() => editChat(current)}
                      >
                        <Icon name="more" />
                        Manage conversation
                      </button>
                    </div>
                  )}
                  {messages.map((m, n) => (
                    <MessageView
                      key={m.id ?? n}
                      message={m}
                      busy={busy}
                      onResend={resendQuestion}
                    />
                  ))}
                  {busy && (
                    <p className="help" role="status">
                      {busyText}
                    </p>
                  )}
                  <div ref={end} />
                </div>
              )}
            </div>
            <div className="composer-dock">
              {workspace.demo_mode && (
                <p className="demo-notice">
                  Demo mode: sample text only. Configure a model for real
                  answers.
                </p>
              )}
              <form className="composer" onSubmit={send}>
                <AttachmentChips
                  files={files}
                  busy={busy}
                  onRemove={(id) =>
                    setDraftFiles((d) => ({
                      ...d,
                      [draftKey]: files.filter((f) => f.id !== id),
                    }))
                  }
                  onRetry={(f) => void retryFile(f)}
                />
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  aria-label="Choose chat files"
                  multiple
                  accept={
                    workspace.supports_images
                      ? ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
                      : ".pdf,.docx,.txt,.md"
                  }
                  onChange={(e) => {
                    void uploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <textarea
                  aria-label="Message Raazi"
                  placeholder="Ask Raazi anything about your work…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={16000}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="composer-footer">
                  <div className="composer-controls">
                    <button
                      type="button"
                      className="upload-button"
                      aria-label="Upload files"
                      title="Upload a document or image"
                      aria-describedby="upload-help"
                      disabled={
                        busy || !workspace.uploads_enabled || files.length >= 5
                      }
                      onClick={() => fileInput.current?.click()}
                    >
                      <Icon name="plus" />
                    </button>
                    <select
                      aria-label="Knowledge repository"
                      value={repository}
                      onChange={(e) => setRepository(e.target.value)}
                    >
                      <option value="">All available knowledge</option>
                      {workspace.repositories.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="composer-right">
                    <details className="model-details">
                      <summary aria-label="Selected model">
                        <span>
                          {workspace.demo_mode
                            ? "Demo mode"
                            : chosenModel?.label || "Select a model"}
                        </span>
                        <Icon name="chevron" />
                      </summary>
                      <div className="model-menu">
                        <strong>
                          {chosenModel?.label || "No model configured"}
                        </strong>
                        <p>
                          {workspace.demo_mode
                            ? "No model is configured. Demo replies test the chat layout and do not answer your question."
                            : "Choose an approved model below. The decision model can route to another approved model when its switch is on."}
                        </p>
                        {workspace.models.map((m) => (
                          <button
                            type="button"
                            key={m.key}
                            aria-pressed={chosenModel?.key === m.key}
                            onClick={(e) => {
                              setModelKey(m.key);
                              e.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                            }}
                          >
                            {m.label}
                          </button>
                        ))}
                        {session.user.role === "admin" && (
                          <button
                            type="button"
                            onClick={() => openView("admin")}
                          >
                            Configure model
                          </button>
                        )}
                      </div>
                    </details>
                    <button
                      className="primary send"
                      aria-label="Send message"
                      disabled={
                        busy ||
                        !draft.trim() ||
                        files.some((f) => f.status !== "ready")
                      }
                    >
                      {busy ? (
                        <span className="send-spinner" aria-hidden="true" />
                      ) : (
                        <Icon name="arrow" />
                      )}
                    </button>
                  </div>
                </div>
                <p id="upload-help" className="upload-help">
                  {workspace.uploads_enabled
                    ? "Files stay private. Documents: 20 MB." +
                      (workspace.supports_images
                        ? " Images: 10 MB."
                        : " Image input is off.")
                    : "Uploads are off. Ask an admin to configure S3 storage."}
                </p>
              </form>
              <div className="chat-switches">
                <label
                  className="decision-toggle"
                  title="Controls thinking generation for models with a configured thinking control."
                >
                  <input
                    type="checkbox"
                    role="switch"
                    checked={thinking && canThink}
                    disabled={busy || !canThink}
                    onChange={(e) => setThinking(e.target.checked)}
                  />
                  <Icon name="thinking" /> Thinking
                </label>
                <label className="decision-toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={useDecision && workspace.routing_enabled}
                    disabled={busy || !workspace.routing_enabled}
                    onChange={(e) => setUseDecision(e.target.checked)}
                  />
                  Use decision model
                  {!workspace.routing_enabled && (
                    <span>Admin setup required</span>
                  )}
                </label>
              </div>
              <p className="footnote">
                AI can provide incorrect information. Check important answers
                and their sources.
              </p>
            </div>
          </div>
        )}
        {view === "admin" && session.user.role === "admin" && (
          <Admin notify={notify} refresh={refresh} />
        )}
        {view === "knowledge" && (
          <div className="page">
            <div className="eyebrow">YOUR ORGANIZATION'S KNOWLEDGE</div>
            <h1>Knowledge library</h1>
            <p className="page-subtitle">
              Choose a repository in chat to focus your questions. Answers link
              to supporting passages.
            </p>
            <div className="grid">
              {workspace.repositories.map((r) => (
                <section key={r.id} className="card">
                  <Icon name="book" />
                  <h2>{r.name}</h2>
                  <p>{r.description || "Enterprise knowledge repository"}</p>
                  <button
                    onClick={() => {
                      setRepository(String(r.id));
                      newChat();
                    }}
                  >
                    Chat with this repository
                  </button>
                </section>
              ))}
            </div>
            <YourFiles
              onUse={(file) => {
                setDraftFiles((d) => ({ ...d, ["new:"]: [file] }));
                newChat();
              }}
            />
            {!workspace.repositories.length && (
              <section className="card">
                <h3>Your library is waiting</h3>
                <p>
                  An administrator can add repositories and upload documents.
                </p>
              </section>
            )}
          </div>
        )}
        {view === "profile" && (
          <div className="page">
            <div className="eyebrow">ENTERPRISE CONTEXT</div>
            <h1>Your profile</h1>
            <PaletteSettings
              palette={session.user.palette ?? "forest"}
              composer_shade={session.user.composer_shade ?? "mist"}
              composer_size={session.user.composer_size ?? "compact"}
              onSaved={(appearance) => {
                setSession((s) =>
                  s?.user ? { ...s, user: { ...s.user, ...appearance } } : s,
                );
                notify("Color palette saved");
              }}
            />
            <section className="card profile-data">
              {[
                ["Name", session.user.name],
                ["Email", session.user.email],
                ["Department", session.user.department],
                ["Job title", session.user.job_title],
                ["Context", session.user.profile],
              ].map(([label, value]) => (
                <div key={label} className={label === "Context" ? "full" : ""}>
                  <small>{label}</small>
                  <p className="pre">{value || "Not supplied"}</p>
                </div>
              ))}
            </section>
            <p className="help">
              Enterprise context helps Raazi tailor answers to your work.
              Contact your administrator to update it.
            </p>
          </div>
        )}
      </main>

      {editor && (
        <Modal
          title={
            editor.kind === "chat"
              ? "Manage conversation"
              : editor.group
                ? "Manage folder"
                : "Create folder"
          }
          onClose={() => {
            if (!busy) setEditor(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (editor.kind === "chat")
                void editorAction(() =>
                  api("/api/conversations/" + editor.chat.id, "PATCH", {
                    title: String(f.get("title")),
                    pinned: f.has("pinned"),
                    group_id: f.get("group_id") || null,
                  }),
                );
              else
                void editorAction(() =>
                  api(
                    "/api/chat-groups" +
                      (editor.group ? "/" + editor.group.id : ""),
                    editor.group ? "PATCH" : "POST",
                    { name: String(f.get("name")) },
                  ),
                );
            }}
          >
            {editor.kind === "chat" ? (
              <>
                <Field label="Chat title">
                  <input
                    autoFocus
                    name="title"
                    required
                    maxLength={200}
                    defaultValue={editor.chat.title}
                  />
                </Field>
                <Field label="Chat folder">
                  <select
                    name="group_id"
                    defaultValue={editor.chat.group_id ?? ""}
                  >
                    <option value="">No folder</option>
                    {workspace.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="checkbox-label">
                  <input
                    name="pinned"
                    type="checkbox"
                    defaultChecked={editor.chat.pinned}
                  />
                  Pin this chat
                </label>
              </>
            ) : (
              <>
                <p className="dialog-description">
                  Keep related conversations together.
                </p>
                <Field label="Folder name">
                  <input
                    autoFocus
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={editor.group?.name ?? ""}
                  />
                </Field>
              </>
            )}
            {dialogError && (
              <p className="form-error" role="alert">
                {dialogError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Save
              </button>
            </div>
            {(editor.kind === "chat" || editor.group) && (
              <div className="dialog-danger-zone">
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    const isChat = editor.kind === "chat";
                    if (
                      !confirm(
                        isChat
                          ? "Delete this conversation?"
                          : "Delete this folder? Its chats will be kept.",
                      )
                    )
                      return;
                    const id = isChat ? editor.chat.id : editor.group!.id;
                    void editorAction(async () => {
                      await api(
                        (isChat ? "/api/conversations/" : "/api/chat-groups/") +
                          id,
                        "DELETE",
                      );
                      if (isChat && cid === id) {
                        setCid(null);
                        setMessages([]);
                        setFolder(null);
                      }
                      if (!isChat && folder === id) setFolder(null);
                    });
                  }}
                >
                  Delete {editor.kind === "chat" ? "chat" : "folder"}
                </button>
                <small>
                  {editor.kind === "chat"
                    ? "This removes the conversation and messages."
                    : "Chats remain in your history."}
                </small>
              </div>
            )}
          </form>
        </Modal>
      )}
      {toast && (
        <div id="toast" className="visible" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
