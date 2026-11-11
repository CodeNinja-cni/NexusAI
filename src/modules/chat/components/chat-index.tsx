"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowRight,
  MessageSquarePlus,
  Pencil,
  Radio,
  RotateCcw,
  Search,
  Trash2
} from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

import type { ChatModel } from "../server/model-catalog";
import styles from "./chat-index.module.css";

type ConversationStatus = "ACTIVE" | "ARCHIVED";
type ConversationFilter = ConversationStatus | "ALL";

interface ConversationSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly status: ConversationStatus;
  readonly modelKey: string | null;
  readonly lastMessageAt: string;
  readonly createdAt: string;
  readonly version: number;
  readonly messageCount: number;
  readonly createdByMe: boolean;
  readonly capabilities: {
    readonly rename: boolean;
    readonly archive: boolean;
    readonly delete: boolean;
  };
}

interface ConversationPagePayload {
  readonly data?: readonly ConversationSummary[];
  readonly meta?: { readonly nextCursor?: string | null };
  readonly detail?: string;
}

type DialogState =
  | { readonly kind: "rename"; readonly conversation: ConversationSummary }
  | { readonly kind: "delete"; readonly conversation: ConversationSummary }
  | null;

export function ChatIndex({
  workspaceId,
  workspaceName,
  conversations,
  nextCursor: initialNextCursor,
  query,
  status,
  createdByMe,
  models
}: {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly conversations: readonly ConversationSummary[];
  readonly nextCursor: string | null;
  readonly query: string;
  readonly status: ConversationFilter;
  readonly createdByMe: boolean;
  readonly models: readonly ChatModel[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [items, setItems] = useState<readonly ConversationSummary[]>(conversations);
  const [searchValue, setSearchValue] = useState(query);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [creating, setCreating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [renameValue, setRenameValue] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const groups = useMemo(() => groupConversations(items), [items]);

  async function createConversation() {
    setCreating(true);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID()
        },
        body: JSON.stringify({ modelKey: models[0]?.key, documentIds: [] })
      });
      const payload = (await response.json()) as { data?: { id: string }; detail?: string };
      if (!response.ok || !payload.data)
        throw new Error(payload.detail ?? "Conversation creation failed.");
      router.push(`/chat/${payload.data.id}` as Route);
    } catch (error) {
      notify({
        tone: "error",
        title: "Conversation not created",
        message: error instanceof Error ? error.message : "Try again."
      });
      setCreating(false);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    router.push(buildChatHref(searchValue.trim(), status, createdByMe));
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setListError(null);
    try {
      const params = new URLSearchParams({
        query,
        status,
        createdByMe: String(createdByMe),
        cursor: nextCursor,
        limit: "30"
      });
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/conversations?${params.toString()}`
      );
      const payload = (await response.json()) as ConversationPagePayload;
      if (!response.ok || !payload.data) throw new Error(payload.detail ?? "History did not load.");
      setItems((current) => [...current, ...payload.data!]);
      setNextCursor(payload.meta?.nextCursor ?? null);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "History did not load.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function patchConversation(
    conversation: ConversationSummary,
    change: { readonly title?: string; readonly status?: ConversationStatus }
  ) {
    setBusyId(conversation.id);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversation.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "If-Match": conversationEtag(conversation)
          },
          body: JSON.stringify(change)
        }
      );
      const payload = (await response.json()) as {
        data?: ConversationSummary;
        detail?: string;
      };
      if (!response.ok || !payload.data) throw new Error(payload.detail ?? "Update failed.");
      const leavesCurrentFilter = status !== "ALL" && payload.data.status !== status;
      setItems((current) =>
        leavesCurrentFilter
          ? current.filter((item) => item.id !== conversation.id)
          : current.map((item) => (item.id === conversation.id ? payload.data! : item))
      );
      setDialog(null);
      notify({
        tone: "success",
        title: change.title ? "Conversation renamed" : "Conversation organized",
        message: change.status === "ARCHIVED" ? "Moved to the archive." : "Moved to active history."
      });
      router.refresh();
    } catch (error) {
      notify({
        tone: "error",
        title: "Conversation not updated",
        message: error instanceof Error ? error.message : "Try again."
      });
    } finally {
      setBusyId(null);
    }
  }

  async function removeConversation(conversation: ConversationSummary) {
    setBusyId(conversation.id);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversation.id}`,
        { method: "DELETE", headers: { "If-Match": conversationEtag(conversation) } }
      );
      if (!response.ok) throw new Error(await readProblemDetail(response));
      setItems((current) => current.filter((item) => item.id !== conversation.id));
      setDialog(null);
      notify({
        tone: "success",
        title: "Conversation removed",
        message: "It is hidden now and remains recoverable for 30 days."
      });
      router.refresh();
    } catch (error) {
      notify({
        tone: "error",
        title: "Conversation not removed",
        message: error instanceof Error ? error.message : "Try again."
      });
    } finally {
      setBusyId(null);
    }
  }

  function openRename(conversation: ConversationSummary) {
    setRenameValue(conversation.title);
    setDialog({ kind: "rename", conversation });
  }

  return (
    <div className={styles.index}>
      <header className={styles.hero}>
        <div>
          <p>{workspaceName} / conversation memory</p>
          <h1>Think in threads, not tabs.</h1>
          <span>
            Search durable message history, shape active work, and archive context without losing
            its workspace boundary.
          </span>
        </div>
        <Button
          size="large"
          leadingIcon={<Icon icon={MessageSquarePlus} />}
          loading={creating}
          loadingLabel="Opening studio"
          onClick={() => void createConversation()}
        >
          New conversation
        </Button>
      </header>

      <section className={styles.catalog} aria-labelledby="models-heading">
        <div>
          <span className={styles.signal} aria-hidden="true">
            <Icon icon={Radio} />
          </span>
          <div>
            <p>Active provider route</p>
            <h2 id="models-heading">{models[0]?.label ?? "No model configured"}</h2>
          </div>
        </div>
        <p>{models[0]?.description}</p>
        {models[0]?.developmentOnly ? (
          <small>Development-only · clearly labelled mock</small>
        ) : null}
      </section>

      <section className={styles.history} aria-labelledby="history-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p>
              {items.length} loaded · {workspaceName}
            </p>
            <h2 id="history-heading">Conversation history</h2>
          </div>
        </div>

        <form className={styles.searchBar} onSubmit={submitSearch} role="search">
          <label className="visually-hidden" htmlFor="conversation-search">
            Search conversation titles and messages
          </label>
          <span aria-hidden="true">
            <Icon icon={Search} />
          </span>
          <input
            id="conversation-search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search titles and message history"
            maxLength={200}
          />
          <Button type="submit" size="small">
            Search
          </Button>
        </form>

        <nav className={styles.filters} aria-label="Conversation filters">
          {(["ACTIVE", "ARCHIVED", "ALL"] as const).map((filter) => (
            <Link
              href={buildChatHref(query, filter, createdByMe)}
              aria-current={status === filter ? "page" : undefined}
              key={filter}
            >
              {filter === "ACTIVE" ? "Active" : filter === "ARCHIVED" ? "Archive" : "All"}
            </Link>
          ))}
          <Link
            href={buildChatHref(query, status, !createdByMe)}
            aria-current={createdByMe ? "page" : undefined}
            className={styles.mine}
          >
            Created by me
          </Link>
        </nav>

        {items.length ? (
          <div className={styles.groups}>
            {groups.map((group) => (
              <section
                className={styles.group}
                aria-labelledby={`group-${group.key}`}
                key={group.key}
              >
                <header>
                  <h3 id={`group-${group.key}`}>{group.label}</h3>
                  <span>{String(group.items.length).padStart(2, "0")}</span>
                </header>
                <ul>
                  {group.items.map((conversation) => (
                    <li key={conversation.id}>
                      <Link
                        className={styles.conversationLink}
                        href={`/chat/${conversation.id}` as Route}
                      >
                        <span
                          className={styles.statusMark}
                          data-status={conversation.status.toLowerCase()}
                        />
                        <div>
                          <strong>{conversation.title}</strong>
                          <small>
                            {formatDate(conversation.lastMessageAt)} · {conversation.messageCount}{" "}
                            {conversation.messageCount === 1 ? "message" : "messages"}
                          </small>
                        </div>
                        <Icon icon={ArrowRight} />
                      </Link>
                      {conversation.capabilities.rename ? (
                        <div className={styles.actions} aria-label={`Manage ${conversation.title}`}>
                          <Button
                            variant="ghost"
                            size="small"
                            aria-label={`Rename ${conversation.title}`}
                            onClick={() => openRename(conversation)}
                            disabled={busyId === conversation.id}
                          >
                            <Icon icon={Pencil} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="small"
                            aria-label={
                              conversation.status === "ACTIVE"
                                ? `Archive ${conversation.title}`
                                : `Restore ${conversation.title} to active history`
                            }
                            onClick={() =>
                              void patchConversation(conversation, {
                                status: conversation.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"
                              })
                            }
                            disabled={busyId === conversation.id}
                          >
                            <Icon icon={conversation.status === "ACTIVE" ? Archive : RotateCcw} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="small"
                            aria-label={`Delete ${conversation.title}`}
                            onClick={() => setDialog({ kind: "delete", conversation })}
                            disabled={busyId === conversation.id}
                          >
                            <Icon icon={Trash2} />
                          </Button>
                        </div>
                      ) : (
                        <span className={styles.shared}>Shared workspace thread</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {nextCursor ? (
              <Button
                variant="secondary"
                loading={loadingMore}
                loadingLabel="Loading history"
                onClick={() => void loadMore()}
              >
                Load older conversations
              </Button>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={<Icon icon={query ? Search : MessageSquarePlus} size={22} />}
            title={
              query || status !== "ACTIVE" || createdByMe
                ? "No conversations match"
                : "Your first thread starts here"
            }
            description={
              query || status !== "ACTIVE" || createdByMe
                ? "Adjust the search or history filters. Workspace boundaries remain applied."
                : "No sample conversations were added. Open a real, persisted thread when you are ready."
            }
            action={
              query || status !== "ACTIVE" || createdByMe ? (
                <Button variant="secondary" onClick={() => router.push("/chat")}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => void createConversation()} loading={creating}>
                  Start a conversation
                </Button>
              )
            }
          />
        )}

        {listError ? (
          <ErrorState
            title="Older history could not load"
            description={listError}
            action={
              <Button variant="secondary" onClick={() => void loadMore()}>
                Try again
              </Button>
            }
          />
        ) : null}
      </section>

      <Modal
        open={dialog?.kind === "rename"}
        onClose={() => setDialog(null)}
        title="Rename conversation"
        description="The new title is visible to members of this workspace."
        footer={
          dialog?.kind === "rename" ? (
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                loading={busyId === dialog.conversation.id}
                loadingLabel="Renaming"
                disabled={!renameValue.trim()}
                onClick={() =>
                  void patchConversation(dialog.conversation, { title: renameValue.trim() })
                }
              >
                Save title
              </Button>
            </>
          ) : undefined
        }
      >
        <FormField
          label="Conversation title"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          maxLength={200}
          autoFocus
        />
      </Modal>

      <Modal
        open={dialog?.kind === "delete"}
        onClose={() => setDialog(null)}
        title="Remove this conversation?"
        description="It disappears from workspace history immediately and remains recoverable for 30 days."
        footer={
          dialog?.kind === "delete" ? (
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Keep conversation
              </Button>
              <Button
                variant="danger"
                loading={busyId === dialog.conversation.id}
                loadingLabel="Removing"
                onClick={() => void removeConversation(dialog.conversation)}
              >
                Remove conversation
              </Button>
            </>
          ) : undefined
        }
      >
        <p className={styles.deleteCopy}>
          <strong>{dialog?.kind === "delete" ? dialog.conversation.title : "Conversation"}</strong>
          <span>Messages and branches stay protected during the recovery window.</span>
        </p>
      </Modal>
    </div>
  );
}

function groupConversations(items: readonly ConversationSummary[]) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = startToday - 6 * 24 * 60 * 60 * 1000;
  const definitions = [
    {
      key: "today",
      label: "Today",
      test: (item: ConversationSummary) => new Date(item.lastMessageAt).getTime() >= startToday
    },
    {
      key: "week",
      label: "Previous 7 days",
      test: (item: ConversationSummary) => {
        const time = new Date(item.lastMessageAt).getTime();
        return time >= weekAgo && time < startToday;
      }
    },
    {
      key: "earlier",
      label: "Earlier",
      test: (item: ConversationSummary) => new Date(item.lastMessageAt).getTime() < weekAgo
    }
  ];
  return definitions
    .map((definition) => ({ ...definition, items: items.filter(definition.test) }))
    .filter((group) => group.items.length > 0);
}

function buildChatHref(query: string, status: ConversationFilter, createdByMe: boolean): Route {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (status !== "ACTIVE") params.set("status", status);
  if (createdByMe) params.set("createdByMe", "true");
  const suffix = params.toString();
  return (suffix ? `/chat?${suffix}` : "/chat") as Route;
}

function conversationEtag(conversation: Pick<ConversationSummary, "id" | "version">) {
  return `"conversation:${conversation.id}:${conversation.version}"`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
}

async function readProblemDetail(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail ?? `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}
