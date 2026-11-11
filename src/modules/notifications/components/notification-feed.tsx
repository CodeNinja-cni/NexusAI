"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  FileCheck2,
  ShieldAlert,
  Trash2,
  UsersRound,
  Workflow
} from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import type { NotificationType } from "../server/validation";
import styles from "./notification-feed.module.css";

interface NotificationItem {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly actionUrl: string | null;
  readonly read: boolean;
  readonly readAt: string | null;
  readonly createdAt: string;
  readonly version: number;
  readonly etag: string;
}

const filters: readonly { label: string; value?: NotificationType }[] = [
  { label: "All activity" },
  { label: "New activity", value: "NEW_ACTIVITY" },
  { label: "Documents", value: "DOCUMENT_PROCESSING" },
  { label: "Workflows", value: "WORKFLOW_STATUS" },
  { label: "System", value: "SYSTEM_ALERT" }
];

export function NotificationFeed({
  initialItems,
  initialUnreadCount,
  activeType,
  unreadOnly
}: {
  readonly initialItems: readonly NotificationItem[];
  readonly initialUnreadCount: number;
  readonly activeType?: NotificationType;
  readonly unreadOnly: boolean;
}) {
  const { notify } = useToast();
  const [items, setItems] = useState(initialItems);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  async function toggleRead(item: NotificationItem) {
    setBusyId(item.id);
    try {
      const response = await fetch(`/api/v1/notifications/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": item.etag },
        body: JSON.stringify({ read: !item.read })
      });
      const payload = (await response.json()) as { data?: NotificationItem; detail?: string };
      if (!response.ok || !payload.data) throw new Error(payload.detail ?? "Update failed.");
      setItems((current) =>
        unreadOnly && payload.data!.read
          ? current.filter((candidate) => candidate.id !== item.id)
          : current.map((candidate) => (candidate.id === item.id ? payload.data! : candidate))
      );
      setUnreadCount((current) => Math.max(0, current + (payload.data!.read ? -1 : 1)));
    } catch (error) {
      notify({
        tone: "error",
        title: "Notification not updated",
        message: error instanceof Error ? error.message : "Try again."
      });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: NotificationItem) {
    setBusyId(item.id);
    try {
      const response = await fetch(`/api/v1/notifications/${item.id}`, {
        method: "DELETE",
        headers: { "If-Match": item.etag }
      });
      if (!response.ok) throw new Error("The notification could not be removed.");
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      if (!item.read) setUnreadCount((current) => Math.max(0, current - 1));
    } catch (error) {
      notify({
        tone: "error",
        title: "Notification not removed",
        message: error instanceof Error ? error.message : "Try again."
      });
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const response = await fetch("/api/v1/notifications/read-receipts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID()
        },
        body: JSON.stringify({ allBefore: new Date().toISOString() })
      });
      if (!response.ok) throw new Error("Notifications could not be marked as read.");
      setItems((current) =>
        unreadOnly
          ? []
          : current.map((item) => ({ ...item, read: true, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
      window.location.reload();
    } catch (error) {
      notify({
        tone: "error",
        title: "Notifications not updated",
        message: error instanceof Error ? error.message : "Try again."
      });
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className={styles.feed}>
      <header className={styles.hero}>
        <div>
          <p>Signal center / {unreadCount} unread</p>
          <h1>Everything that changed, without the noise.</h1>
          <span>
            Workspace activity, document processing, workflow status, and security alerts stay tied
            to your account.
          </span>
        </div>
        <Button
          variant="secondary"
          leadingIcon={<Icon icon={CheckCheck} />}
          disabled={unreadCount === 0}
          loading={markingAll}
          loadingLabel="Marking all"
          onClick={() => void markAllRead()}
        >
          Mark all read
        </Button>
      </header>

      <nav className={styles.filters} aria-label="Notification filters">
        {filters.map((filter) => {
          const active = filter.value === activeType || (!filter.value && !activeType);
          const query = new URLSearchParams();
          if (filter.value) query.set("type", filter.value);
          if (unreadOnly) query.set("unread", "true");
          return (
            <Link
              key={filter.label}
              href={`/notifications${query.size ? `?${query.toString()}` : ""}` as Route}
              aria-current={active ? "page" : undefined}
            >
              {filter.label}
            </Link>
          );
        })}
        <ButtonLink
          href={(unreadOnly ? "/notifications" : "/notifications?unread=true") as Route}
          variant="ghost"
          size="small"
        >
          {unreadOnly ? "Show all" : "Unread only"}
        </ButtonLink>
      </nav>

      {items.length ? (
        <ol className={styles.list}>
          {items.map((item) => (
            <li key={item.id} data-unread={!item.read || undefined}>
              <span className={styles.icon} aria-hidden="true">
                <Icon icon={iconFor(item.type)} />
              </span>
              <div className={styles.content}>
                <div className={styles.itemHeading}>
                  <div>
                    <StatusPill tone={item.read ? "neutral" : "info"}>
                      {labelFor(item.type)}
                    </StatusPill>
                    <h2>{item.title}</h2>
                  </div>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </div>
                <p>{item.body}</p>
                <div className={styles.actions}>
                  {item.actionUrl ? (
                    <ButtonLink href={item.actionUrl as Route} size="small">
                      Open
                    </ButtonLink>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={busyId === item.id}
                    onClick={() => void toggleRead(item)}
                  >
                    Mark {item.read ? "unread" : "read"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    aria-label={`Remove ${item.title}`}
                    disabled={busyId === item.id}
                    leadingIcon={<Icon icon={Trash2} />}
                    onClick={() => void remove(item)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          icon={<Icon icon={Bell} />}
          title={unreadOnly ? "You are all caught up" : "No notifications yet"}
          description="Durable product and security events will appear here when they happen."
        />
      )}
    </div>
  );
}

function iconFor(type: string) {
  if (type === "DOCUMENT_PROCESSING") return FileCheck2;
  if (type === "WORKFLOW_STATUS") return Workflow;
  if (type === "SYSTEM_ALERT") return ShieldAlert;
  return UsersRound;
}

function labelFor(type: string) {
  if (type === "DOCUMENT_PROCESSING") return "Document";
  if (type === "WORKFLOW_STATUS") return "Workflow";
  if (type === "SYSTEM_ALERT") return "System";
  return "Activity";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
}
