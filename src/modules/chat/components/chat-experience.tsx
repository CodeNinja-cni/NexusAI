"use client";

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { ArrowDown, CircleStop, RefreshCw, Send, Sparkles, UserRound } from "lucide-react";

import { useToast } from "@/components/feedback/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";

import type { ChatModel } from "../server/model-catalog";
import styles from "./chat-experience.module.css";

interface ChatMessage {
  readonly id: string;
  readonly role: "USER" | "ASSISTANT";
  readonly status:
    "PENDING" | "STREAMING" | "CANCEL_REQUESTED" | "COMPLETED" | "CANCELLED" | "FAILED";
  readonly content: string;
  readonly model: string | null;
  readonly errorCode: string | null;
  readonly supersedesMessageId: string | null;
  readonly createdAt: string;
  readonly citations?: readonly ChatCitation[];
}

interface ChatCitation {
  readonly ordinal: number;
  readonly documentId: string;
  readonly documentName: string | null;
  readonly chunkOrdinal: number;
  readonly excerpt: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
}

interface StreamEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

export function ChatExperience({
  workspaceId,
  conversationId,
  title,
  status,
  workspaceName,
  createdAt,
  lastMessageAt,
  initialModelKey,
  models,
  initialMessages,
  initialHistoryCursor
}: {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly title: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly workspaceName: string;
  readonly createdAt: string;
  readonly lastMessageAt: string;
  readonly initialModelKey: string;
  readonly models: readonly ChatModel[];
  readonly initialMessages: readonly ChatMessage[];
  readonly initialHistoryCursor: string | null;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [modelKey, setModelKey] = useState(initialModelKey);
  const [generating, setGenerating] = useState(false);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState(initialHistoryCursor);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const endpoint = `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`;
  const currentModel = useMemo(
    () => models.find((model) => model.key === modelKey) ?? models[0],
    [modelKey, models]
  );

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || generating) return;
    setPrompt("");
    setStreamError(null);
    await runGeneration(
      `${endpoint}/messages`,
      {
        clientMessageId: crypto.randomUUID(),
        content,
        modelKey,
        documentIds: []
      },
      content
    );
  }

  async function regenerate(messageId: string) {
    if (generating) return;
    setStreamError(null);
    await runGeneration(
      `${endpoint}/messages/${messageId}/regenerations`,
      { clientGenerationId: crypto.randomUUID(), modelKey },
      undefined,
      messageId
    );
  }

  async function runGeneration(
    url: string,
    body: Record<string, unknown>,
    userContent?: string,
    supersedesMessageId?: string
  ) {
    setGenerating(true);
    let terminalEvent = false;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID()
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(await readProblemDetail(response));
      if (!response.body) throw new Error("The stream did not open.");

      await readEventStream(response.body, (streamEvent) => {
        const data = streamEvent.data;
        if (streamEvent.event === "generation.started") {
          const assistantMessageId = String(data.assistantMessageId);
          setActiveAssistantId(assistantMessageId);
          setMessages((current) => [
            ...current,
            ...(userContent
              ? [
                  {
                    id: String(data.userMessageId),
                    role: "USER" as const,
                    status: "COMPLETED" as const,
                    content: userContent,
                    model: null,
                    errorCode: null,
                    supersedesMessageId: null,
                    createdAt: new Date().toISOString()
                  }
                ]
              : []),
            {
              id: assistantMessageId,
              role: "ASSISTANT",
              status: "STREAMING",
              content: "",
              model: String(data.model),
              errorCode: null,
              supersedesMessageId: supersedesMessageId ?? null,
              createdAt: new Date().toISOString(),
              citations: Array.isArray(data.citations)
                ? (data.citations as unknown as readonly ChatCitation[])
                : []
            }
          ]);
          scrollToLatest();
        }
        if (streamEvent.event === "message.delta") {
          const id = String(data.assistantMessageId);
          setMessages((current) =>
            current.map((message) =>
              message.id === id
                ? {
                    ...message,
                    status: "STREAMING",
                    content: `${message.content}${String(data.delta)}`
                  }
                : message
            )
          );
          scrollToLatest();
        }
        if (streamEvent.event === "generation.completed") {
          terminalEvent = true;
          updateTerminalMessage(String(data.assistantMessageId), "COMPLETED", null);
        }
        if (streamEvent.event === "generation.cancelled") {
          terminalEvent = true;
          updateTerminalMessage(
            String(data.assistantMessageId),
            "CANCELLED",
            "generation_cancelled"
          );
        }
        if (streamEvent.event === "generation.error") {
          terminalEvent = true;
          const message = String(data.message ?? "The provider could not complete this response.");
          setStreamError(message);
          updateTerminalMessage(String(data.assistantMessageId), "FAILED", String(data.code));
        }
      });

      if (!terminalEvent) {
        setStreamError(
          "The connection ended before a terminal event. Reload to reconcile persisted state."
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The generation request failed.";
      setStreamError(message);
      notify({ tone: "error", title: "Response interrupted", message });
    } finally {
      setGenerating(false);
      setActiveAssistantId(null);
      router.refresh();
    }
  }

  function updateTerminalMessage(
    id: string,
    status: ChatMessage["status"],
    errorCode: string | null
  ) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, status, errorCode } : message))
    );
  }

  async function stopGeneration() {
    if (!activeAssistantId) return;
    try {
      const response = await fetch(`${endpoint}/generations/${activeAssistantId}/cancellation`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() }
      });
      if (!response.ok) throw new Error(await readProblemDetail(response));
      setMessages((current) =>
        current.map((message) =>
          message.id === activeAssistantId ? { ...message, status: "CANCEL_REQUESTED" } : message
        )
      );
    } catch (error) {
      notify({
        tone: "error",
        title: "Stop request not confirmed",
        message: error instanceof Error ? error.message : "Try again."
      });
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function scrollToLatest() {
    window.requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function loadOlderMessages() {
    if (!historyCursor || loadingHistory) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const response = await fetch(
        `${endpoint}/messages?cursor=${encodeURIComponent(historyCursor)}&limit=50`
      );
      const payload = (await response.json()) as {
        data?: readonly ChatMessage[];
        meta?: { nextCursor?: string | null };
        detail?: string;
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.detail ?? "Earlier messages did not load.");
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        return [...payload.data!.filter((message) => !currentIds.has(message.id)), ...current];
      });
      setHistoryCursor(payload.meta?.nextCursor ?? null);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Earlier messages did not load.");
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <div className={styles.studio}>
      <header className={styles.header}>
        <div>
          <p>
            {workspaceName} / {status === "ACTIVE" ? "live conversation" : "archived context"}
          </p>
          <h1>{title}</h1>
          <small>
            Created {formatTimestamp(createdAt)} · Last activity {formatTimestamp(lastMessageAt)}
          </small>
        </div>
        <div className={styles.modelControl}>
          <label htmlFor="chat-model">Model route</label>
          <Select
            id="chat-model"
            value={modelKey}
            onChange={(event) => setModelKey(event.target.value)}
            disabled={generating || status === "ARCHIVED"}
          >
            {models.map((model) => (
              <option value={model.key} key={model.key}>
                {model.label}
              </option>
            ))}
          </Select>
          {currentModel?.developmentOnly ? <small>Mock · no external provider call</small> : null}
        </div>
      </header>

      <div className={styles.viewport} ref={viewportRef} aria-live="polite" aria-busy={generating}>
        {messages.length ? (
          <ol className={styles.messages}>
            {historyCursor ? (
              <li className={styles.historyControl}>
                <Button
                  variant="secondary"
                  size="small"
                  loading={loadingHistory}
                  loadingLabel="Loading earlier messages"
                  onClick={() => void loadOlderMessages()}
                >
                  Load earlier messages
                </Button>
                {historyError ? <span role="alert">{historyError}</span> : null}
              </li>
            ) : null}
            {messages.map((message) => (
              <li
                className={styles.message}
                data-role={message.role.toLowerCase()}
                key={message.id}
              >
                <div className={styles.avatar} aria-hidden="true">
                  <Icon icon={message.role === "USER" ? UserRound : Sparkles} />
                </div>
                <article>
                  <header>
                    <strong>{message.role === "USER" ? "You" : "NEXUS"}</strong>
                    <div className={styles.messageMeta}>
                      <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
                      <span data-status={message.status.toLowerCase()}>
                        {formatStatus(message.status)}
                      </span>
                    </div>
                  </header>
                  {message.role === "ASSISTANT" ? (
                    message.content ? (
                      <div className={styles.markdown}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight]}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className={styles.thinking} aria-label="Generating response">
                        <i /> <i /> <i />
                      </div>
                    )
                  ) : (
                    <p className={styles.userCopy}>{message.content}</p>
                  )}
                  {message.role === "ASSISTANT" && message.citations?.length ? (
                    <ol className={styles.citations} aria-label="Answer sources">
                      {message.citations.map((citation) => (
                        <li key={`${message.id}:${citation.ordinal}`}>
                          <strong>
                            [{citation.ordinal}] {citation.documentName ?? "Document source"}
                          </strong>
                          <span>
                            {citation.pageStart
                              ? `Page ${citation.pageStart}${citation.pageEnd && citation.pageEnd !== citation.pageStart ? `–${citation.pageEnd}` : ""}`
                              : `Chunk ${citation.chunkOrdinal + 1}`}
                          </span>
                          <p>{citation.excerpt}</p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {message.supersedesMessageId ? (
                    <small className={styles.branch}>Regenerated branch</small>
                  ) : null}
                  {message.role === "ASSISTANT" &&
                  message.status !== "STREAMING" &&
                  message.status !== "PENDING" &&
                  message.status !== "CANCEL_REQUESTED" &&
                  !message.citations?.length ? (
                    <footer>
                      <Button
                        variant="ghost"
                        size="small"
                        leadingIcon={<Icon icon={RefreshCw} />}
                        disabled={generating}
                        onClick={() => void regenerate(message.id)}
                      >
                        Regenerate
                      </Button>
                    </footer>
                  ) : null}
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <section className={styles.blank}>
            <span aria-hidden="true">
              <Icon icon={Sparkles} />
            </span>
            <p>CONTEXT / READY</p>
            <h2>Begin with the thing worth thinking through.</h2>
            <small>
              Your message and the response will be persisted before this thread leaves the screen.
            </small>
          </section>
        )}
      </div>

      {streamError ? (
        <aside className={styles.recovery} role="alert">
          <div>
            <strong>Response needs attention</strong>
            <span>{streamError}</span>
          </div>
          <Button variant="secondary" size="small" onClick={() => window.location.reload()}>
            Reload persisted state
          </Button>
        </aside>
      ) : null}

      {status === "ARCHIVED" ? (
        <aside className={styles.archived} role="status">
          This conversation is archived. Restore it from conversation history to continue.
        </aside>
      ) : null}

      <form className={styles.composer} onSubmit={(event) => void sendMessage(event)}>
        <label className="visually-hidden" htmlFor="chat-prompt">
          Message NEXUS
        </label>
        <textarea
          id="chat-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="Ask, analyze, draft, or reason through something…"
          rows={3}
          maxLength={32_000}
          disabled={generating || status === "ARCHIVED"}
        />
        <div className={styles.composerMeta}>
          <span>⌘ Enter to send · persisted stream</span>
          {status === "ARCHIVED" ? (
            <Button type="button" variant="secondary" disabled>
              Archived
            </Button>
          ) : generating ? (
            <Button
              type="button"
              variant="danger"
              leadingIcon={<Icon icon={CircleStop} />}
              onClick={() => void stopGeneration()}
              disabled={!activeAssistantId}
            >
              Stop generation
            </Button>
          ) : (
            <Button type="submit" trailingIcon={<Icon icon={Send} />} disabled={!prompt.trim()}>
              Send message
            </Button>
          )}
        </div>
      </form>

      <button
        className={styles.jump}
        type="button"
        onClick={scrollToLatest}
        aria-label="Jump to latest message"
      >
        <Icon icon={ArrowDown} />
      </button>
    </div>
  );
}

async function readEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseEvent(block);
      if (parsed) onEvent(parsed);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
}

function parseEvent(block: string): StreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: JSON.parse(data.join("\n")) as Record<string, unknown> };
}

async function readProblemDetail(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail ?? `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

function formatStatus(status: ChatMessage["status"]) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
