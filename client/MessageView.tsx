import { Children, useState, type ReactElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, Source, Attachment } from "../shared/types";
import { AttachmentChips } from "./Uploads";
import { Icon } from "./ui";
import { splitThinking } from "../shared/thinking";
function CopyButton({
  text,
  label = "Copy response",
}: {
  text: string;
  label?: string;
}) {
  const [state, setState] = useState("");
  return (
    <button
      type="button"
      className="text-button copy-button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("Copied");
        } catch {
          setState("Copy failed. Select the text and copy it.");
        }
      }}
    >
      <Icon name="copy" />
      {state || label}
    </button>
  );
}
type Ast = { type: string; value?: string; url?: string; children?: Ast[] };
function citationPlugin(sources: Source[]) {
  return () => (tree: Ast) => {
    function walk(node: Ast) {
      if (
        ["link", "linkReference", "code", "inlineCode", "html"].includes(
          node.type,
        ) ||
        !node.children
      )
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text") {
          walk(child);
          return [child];
        }
        const value = child.value ?? "",
          result: Ast[] = [];
        let start = 0;
        for (const match of value.matchAll(/\[(\d+)\]/g)) {
          const source = sources[Number(match[1]) - 1];
          if (!source || !/^\/sources\/[a-f0-9]{32}$/.test(source.url))
            continue;
          const at = match.index!;
          if (at > start)
            result.push({ type: "text", value: value.slice(start, at) });
          result.push({
            type: "link",
            url: source.url,
            children: [{ type: "text", value: match[0] }],
          });
          start = at + match[0].length;
        }
        if (start < value.length)
          result.push({ type: "text", value: value.slice(start) });
        return result.length ? result : [child];
      });
    }
    walk(tree);
  };
}
function CodeBlock({ children }: { children: ReactNode }) {
  const code = Children.toArray(children)[0] as
    ReactElement<{ children?: ReactNode; className?: string }> | undefined;
  const text = String(code?.props.children ?? ""),
    language = code?.props.className?.replace("language-", "") ?? "Code";
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{language}</span>
        <CopyButton text={text} label="Copy code" />
      </div>
      <pre>{children}</pre>
    </div>
  );
}
function list<T>(value: T[] | string | undefined): T[] {
  try {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
export function MessageView({
  message,
  platformName = "Raazi",
  busy,
  onResend,
}: {
  platformName?: string;
  message: Message;
  busy: boolean;
  onResend: (message: Message, prompt: string) => Promise<boolean>;
}) {
  const sources = list<Source>(message.sources),
    attached = list<Attachment>(message.attachments);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(message.content);
  const reply =
    message.role === "assistant"
      ? splitThinking(message.content, message.reasoning)
      : { content: message.content, reasoning: "" };
  const safeURL = (source: Source) =>
    /^\/sources\/[a-f0-9]{32}$/.test(source.url) ? source.url : "#";
  return (
    <article className={"message " + message.role}>
      <div className="author">
        {message.role === "user" ? "You" : platformName}
      </div>
      <AttachmentChips files={attached} />
      {reply.reasoning && (
        <details className="message-thinking">
          <summary>
            <Icon name="thinking" /> Thoughts <Icon name="chevron" />
          </summary>
          <div className="thinking-text">{reply.reasoning}</div>
        </details>
      )}
      {editing ? (
        <form
          className="question-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onResend(message, draft)) setEditing(false);
          }}
        >
          <textarea
            autoFocus
            aria-label="Edit question"
            value={draft}
            maxLength={16000}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p>
            After a successful answer, this replaces the question and its later
            replies.
          </p>
          <div className="form-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel edit
            </button>
            <button className="primary" disabled={busy || !draft.trim()}>
              Save and resend
            </button>
          </div>
        </form>
      ) : message.role === "assistant" ? (
        <div className="text markdown">
          <Markdown
            remarkPlugins={[remarkGfm, citationPlugin(sources)]}
            skipHtml
            components={{
              pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
              a: ({ href, children }) => (
                <a
                  href={href}
                  className={
                    href && /^\/sources\/[a-f0-9]{32}$/.test(href)
                      ? "citation"
                      : undefined
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              img: ({ alt }) => (
                <span className="help">
                  [Image omitted{alt ? ": " + alt : ""}]
                </span>
              ),
              table: ({ children }) => (
                <div className="table-scroll">
                  <table>{children}</table>
                </div>
              ),
            }}
          >
            {reply.content}
          </Markdown>
        </div>
      ) : (
        <div className="text">{message.content}</div>
      )}
      {sources.length > 0 && (
        <div className="sources">
          Sources · {sources.length}
          {sources.map((source, n) => (
            <details key={source.source_id ?? n}>
              <summary>
                [{n + 1}] {source.title} · {source.label}
              </summary>
              <p>{source.content}</p>
              <a
                href={safeURL(source)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View source{source.page ? " · page " + source.page : ""} ↗
              </a>
            </details>
          ))}
        </div>
      )}
      {!editing && (
        <div className="message-tools">
          <CopyButton
            text={reply.content}
            label={
              message.role === "assistant" ? "Copy response" : "Copy question"
            }
          />
          {message.role === "user" && message.id != null && (
            <>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
              >
                <Icon name="edit" />
                Edit question
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void onResend(message, message.content)}
              >
                <Icon name="refresh" />
                Resend question
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
