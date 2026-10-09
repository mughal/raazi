import { KnowledgeLibrary } from "./KnowledgeLibrary";
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
  | { kind: "chat"; chat: Chat }
  | {
      kind: "group";
      group: Group | null;
      repository?: number | null;
      personalFile?: string | null;
    };
function SourceView({
  id,
  platformName,
}: {
  id: string;
  platformName: string;
}) {
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
      <a href="/">← Back to {platformName}</a>
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
    [navigationReady, setNavigationReady] = useState(false),
    [view, setView] = useState("chat"),
    [cid, setCid] = useState<string | null>(null),
    [folder, setFolder] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [draftFiles, setDraftFiles] = useState<Record<string, Attachment[]>>({}),
    [busyText, setBusyText] = useState("Raazi is thinking…"),
    [repository, setRepository] = useState(""),
    [personalFile, setPersonalFile] = useState<string | null>(null),
    [modelKey, setModelKey] = useState(""),
    [thinking, setThinking] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [editor, setEditor] = useState<Editor | null>(null),
    [dialogError, setDialogError] = useState("");
  const platformName = session?.platform_name || "Raazi";
  useEffect(() => {
    document.title = `${platformName} · SNGPL enterprise workspace`;
  }, [platformName]);
  const chatScroll = useRef<HTMLDivElement>(null),
    end = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    loadSequence = useRef(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    draftKey =
      cid ??
      "new:" + repository + ":" + (personalFile ?? "") + ":" + (folder ?? ""),
    draft = drafts[draftKey] ?? "",
    files = draftFiles[draftKey] ?? [];
  const setDraft = (value: string) =>
    setDrafts((d) => ({ ...d, [draftKey]: value }));
  const removeDraftFile = (id: string) => {
    const remaining = files.filter((f) => f.id !== id);
    if (!cid && id === personalFile) {
      setPersonalFile(null);
      setFolder(null);
      setDrafts((d) => ({ ...d, ["new:::"]: draft }));
      setDraftFiles((d) => ({
        ...d,
        [draftKey]: remaining,
        ["new:::"]: remaining,
      }));
    } else {
      setDraftFiles((d) => ({ ...d, [draftKey]: remaining }));
    }
  };
  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  };
  async function refresh() {
    const next = await api<Workspace>("/api/workspace");
    setWorkspace(next);
    return next;
  }
  async function loadSession() {
    setNavigationReady(false);
    const s = await api<Session>("/api/session");
    setCSRF(s.csrf);
    setSession(s);
    if (s.user) {
      const loaded = await refresh();
      const saved = sessionStorage.getItem("raazi-page:" + s.user.id);
      if (saved)
        try {
          const state = JSON.parse(saved);
          if (
            ["chat", "admin", "knowledge", "profile"].includes(state.view) &&
            (state.view !== "admin" || s.user.role === "admin")
          )
            setView(state.view);
          if (state.cid && state.view === "chat") {
            try {
              setMessages(
                await api<Message[]>(
                  "/api/conversations/" + encodeURIComponent(state.cid),
                ),
              );
              setCid(state.cid);
              const chat = loaded.conversations.find((c) => c.id === state.cid);
              setFolder(chat?.group_id ?? null);
              setPersonalFile(chat?.personal_file_id ?? null);
              setRepository(
                chat?.repository_id ? String(chat.repository_id) : "",
              );
            } catch {
              setCid(null);
              setMessages([]);
            }
          }
        } catch {
          /* Ignore invalid browser state. */
        }
    } else {
      if (session?.user)
        sessionStorage.removeItem("raazi-page:" + session.user.id);
      setWorkspace(null);
      setPersonalFile(null);
      setRepository("");
      setFolder(null);
      setMessages([]);
      setCid(null);
      setDrafts({});
      setDraftFiles({});
      setView("chat");
    }
    setNavigationReady(true);
  }
  useEffect(() => {
    if (navigationReady && session?.user && workspace)
      sessionStorage.setItem(
        "raazi-page:" + session.user.id,
        JSON.stringify({ view, cid }),
      );
  }, [view, cid, session?.user?.id, workspace, navigationReady]);
  useEffect(() => {
    if (!session?.user) return;
    const check = () => {
      void api<Session>("/api/session")
        .then(async (s) => {
          if (!s.user) await loadSession();
          else setSession(s);
        })
        .catch(() => {});
    };
    const ended = () => {
      void loadSession().catch(() => {});
    };
    const timer = setInterval(check, 30000);
    window.addEventListener("raazi-session-ended", ended);
    return () => {
      clearInterval(timer);
      window.removeEventListener("raazi-session-ended", ended);
    };
  }, [session?.user?.id]);
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
    label = `${platformName} is thinking…`,
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
  const newChat = (
    group?: string,
    repo: number | null = null,
    file: string | null = null,
  ) => {
    if (busy) return;
    loadSequence.current++;
    setCid(null);
    setFolder(group ?? null);
    setRepository(repo ? String(repo) : "");
    setPersonalFile(file);
    if (file) {
      const selected = workspace?.personal_files.find((f) => f.id === file);
      if (selected)
        setDraftFiles((d) => ({
          ...d,
          ["new:" + (repo ?? "") + ":" + file + ":" + (group ?? "")]: [
            selected,
          ],
        }));
    }
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
      setPersonalFile(chat.personal_file_id);
      setRepository(chat.repository_id ? String(chat.repository_id) : "");
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
      await refresh();
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
        personal_file_id: personalFile,
        attachment_ids: submittedFiles.map((f) => f.id),
        model_key: modelKey || undefined,
        use_decision: !!workspace?.routing_enabled,
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
      const saved = (await refresh()).conversations.find(
        (c) => c.id === result.conversation_id,
      );
      setPersonalFile(saved?.personal_file_id ?? null);
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
        personal_file_id: personalFile,
        attachment_ids: attached.map((f: Attachment) => f.id),
        model_key: modelKey || undefined,
        use_decision: !!workspace?.routing_enabled,
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
            {platformName} <small>ENTERPRISE</small>
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
  if (sourceId) return <SourceView id={sourceId} platformName={platformName} />;
  if (!workspace)
    return <div className="loading">{error || "Loading workspace…"}</div>;
  const chosenModel =
    workspace.models.find(
      (m) => m.key === (modelKey || workspace.default_model),
    ) ?? workspace.models[0];
  const canThink = workspace.routing_enabled
    ? workspace.models.some((m) => m.supports_thinking)
    : !!chosenModel?.supports_thinking;
  const current = workspace.conversations.find((c) => c.id === cid),
    currentFolder = workspace.groups.find((g) => g.id === folder);
  const editChat = (chat: Chat) => {
      setDialogError("");
      setEditor({ kind: "chat", chat });
    },
    editGroup = (
      group: Group | null,
      repo: number | null = null,
      file: string | null = null,
    ) => {
      setDialogError("");
      setEditor({
        kind: "group",
        group,
        repository: group?.repository_id ?? repo,
        personalFile: group?.personal_file_id ?? file,
      });
    };
  async function editorAction(action: () => Promise<unknown>) {
    setBusy(true);
    setDialogError("");
    try {
      await action();
      const next = await refresh();
      if (cid)
        setFolder(
          next.conversations.find((c) => c.id === cid)?.group_id ?? null,
        );
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
        platformName={platformName}
        workspace={workspace}
        user={session.user}
        view={view}
        active={cid}
        folder={folder}
        repository={repository}
        personalFile={personalFile}
        moveChat={(chat, group) =>
          void perform(async () => {
            await api("/api/conversations/" + chat.id, "PATCH", {
              group_id: group,
            });
            const next = await refresh();
            if (cid === chat.id)
              setFolder(
                next.conversations.find((c) => c.id === cid)?.group_id ?? null,
              );
          }, "Moving chat…")
        }
        deleteChat={(chat) =>
          void perform(async () => {
            if (!confirm("Delete this conversation?")) return;
            await api("/api/conversations/" + chat.id, "DELETE");
            if (cid === chat.id) {
              setCid(null);
              setFolder(null);
              setPersonalFile(null);
              setRepository("");
              setMessages([]);
            }
            await refresh();
          }, "Deleting chat…")
        }
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
                  : `${platformName} enterprise workspace`}
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
                      platformName={platformName}
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
              <form
                className="composer"
                onSubmit={send}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("Files"))
                    e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (workspace.uploads_enabled)
                    void uploadFiles(e.dataTransfer.files);
                  else
                    setError(
                      "Uploads are off. Ask an admin to configure storage.",
                    );
                }}
              >
                <AttachmentChips
                  files={files}
                  busy={busy}
                  onRemove={removeDraftFile}
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
                  aria-label={`Message ${platformName}`}
                  placeholder={`Ask ${platformName} anything about your work…`}
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
                      title={
                        workspace.supports_images
                          ? "Upload PDF, DOCX, TXT, Markdown (20 MB), or PNG, JPEG, WebP (10 MB)"
                          : "Upload PDF, DOCX, TXT, or Markdown (20 MB). Image input is off."
                      }
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
                      disabled={busy || !!cid}
                      onChange={(e) => {
                        setRepository(e.target.value);
                        setPersonalFile(null);
                        setFolder(null);
                      }}
                    >
                      <option value="">
                        {personalFile
                          ? "Personal · " +
                            (workspace.personal_files.find(
                              (f) => f.id === personalFile,
                            )?.filename ?? "Unavailable file")
                          : "General chat"}
                      </option>
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
                            : "Choose an approved model below. The decision model can route to another approved model when enabled by your administrator."}
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
                {repository && (
                  <p className="help">
                    Knowledge-only: answers use the selected repository.
                    Attached files are excluded. Missing evidence returns a
                    no-information message.
                  </p>
                )}
                <p id="upload-help" className="upload-help">
                  {workspace.uploads_enabled
                    ? "Drop files here or use + to select several. Files stay private. PDF, DOCX, TXT, Markdown: 20 MB." +
                      (workspace.supports_images
                        ? " PNG, JPEG, WebP: 10 MB."
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
                {workspace.routing_enabled && (
                  <span className="help">
                    Decision routing enabled by administrator
                  </span>
                )}
              </div>
              <p className="footnote">
                AI can provide incorrect information. Check important answers
                and their sources.
              </p>
            </div>
          </div>
        )}
        {view === "admin" && session.user.role === "admin" && (
          <Admin
            notify={notify}
            refresh={async () => {
              await refresh();
            }}
            platformName={platformName}
            refreshPlatform={loadSession}
            onSessionEnded={loadSession}
          />
        )}
        {view === "knowledge" && (
          <div className="page">
            <KnowledgeLibrary
              userId={session.user.id}
              onChat={(id) => {
                newChat(undefined, id);
              }}
            />
            <YourFiles
              onChanged={async () => {
                await refresh();
              }}
              onUse={(file) => {
                newChat(undefined, null, file.id);
              }}
            />
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
              Enterprise context helps {platformName} tailor answers to your
              work. Contact your administrator to update it.
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
                    {
                      name: String(f.get("name")),
                      ...(editor.group
                        ? {}
                        : {
                            repository_id: editor.repository ?? null,
                            personal_file_id: editor.personalFile ?? null,
                          }),
                    },
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
                    {workspace.groups
                      .filter(
                        (g) =>
                          g.repository_id === editor.chat.repository_id &&
                          g.personal_file_id === editor.chat.personal_file_id,
                      )
                      .map((g) => (
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
                  disabled={
                    busy ||
                    (editor.kind === "group" &&
                      workspace.conversations.some(
                        (c) => c.group_id === editor.group?.id,
                      ))
                  }
                  onClick={() => {
                    const isChat = editor.kind === "chat";
                    if (
                      !confirm(
                        isChat
                          ? "Delete this conversation?"
                          : "Delete this empty folder?",
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
                    : "Move or delete all chats before deleting a folder."}
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
