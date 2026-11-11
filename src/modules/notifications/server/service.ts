import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/platform/database/prisma";

import { notificationCreateSchema, type NotificationType } from "./validation";

type DatabaseClient = Prisma.TransactionClient | typeof prisma;

const allowedActionRoots = [
  "/dashboard",
  "/workspace",
  "/chat",
  "/documents",
  "/workflows",
  "/usage",
  "/notifications",
  "/settings"
];

function validateActionUrl(value: string | null | undefined) {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("invalid_notification_action_url");
  }
  const url = new URL(value, "https://nexus.local");
  if (
    url.origin !== "https://nexus.local" ||
    !allowedActionRoots.some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`))
  ) {
    throw new Error("invalid_notification_action_url");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function notificationDeduplicationKey(eventKey: string | undefined) {
  return eventKey
    ? createHash("sha256").update(`notification:${eventKey}`).digest("hex")
    : undefined;
}

function preferenceKey(type: NotificationType) {
  if (type === "NEW_ACTIVITY") return "newActivity";
  if (type === "DOCUMENT_PROCESSING") return "documentProcessing";
  if (type === "WORKFLOW_STATUS") return "workflowStatus";
  return null;
}

export async function createNotification(
  database: DatabaseClient,
  input: {
    readonly userId: string;
    readonly workspaceId?: string | null;
    readonly type: NotificationType;
    readonly title: string;
    readonly body: string;
    readonly actionUrl?: string | null;
    readonly data?: Readonly<Record<string, string | number | boolean | null>>;
    readonly eventKey?: string;
    readonly expiresAt?: Date | null;
  }
) {
  const parsed = notificationCreateSchema.parse(input);
  const actionUrl = validateActionUrl(parsed.actionUrl);

  const key = preferenceKey(parsed.type);
  if (key) {
    const preference = await database.userPreference.findUnique({
      where: { userId: parsed.userId },
      select: { notificationPreferences: true }
    });
    const values =
      preference?.notificationPreferences &&
      !Array.isArray(preference.notificationPreferences) &&
      typeof preference.notificationPreferences === "object"
        ? (preference.notificationPreferences as Record<string, unknown>)
        : {};
    if (values[key] === false) return null;
  }

  if (parsed.workspaceId) {
    const membership = await database.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: parsed.workspaceId, userId: parsed.userId },
        workspace: { status: "ACTIVE", deletedAt: null }
      },
      select: { id: true }
    });
    if (!membership) return null;
  }

  const data: Prisma.NotificationUncheckedCreateInput = {
    userId: parsed.userId,
    workspaceId: parsed.workspaceId ?? null,
    type: parsed.type,
    title: parsed.title,
    body: parsed.body,
    actionUrl,
    data: parsed.data,
    expiresAt: parsed.expiresAt ?? null,
    deduplicationKey: notificationDeduplicationKey(parsed.eventKey) ?? null
  };

  if (!data.deduplicationKey) {
    return database.notification.create({ data, select: { id: true } });
  }

  return database.notification.upsert({
    where: { deduplicationKey: data.deduplicationKey },
    create: data,
    update: {},
    select: { id: true }
  });
}

export function notificationEtag(id: string, version: number) {
  return `"notification:${id}:${version}"`;
}

export function serializeNotification(notification: {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly actionUrl: string | null;
  readonly data: unknown;
  readonly readAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}) {
  return {
    ...notification,
    read: Boolean(notification.readAt),
    readAt: notification.readAt?.toISOString() ?? null,
    expiresAt: notification.expiresAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
    etag: notificationEtag(notification.id, notification.version)
  };
}

export async function getNotificationPage(
  userId: string,
  input: { readonly unread?: boolean; readonly type?: NotificationType; readonly limit?: number }
) {
  const now = new Date();
  const rows = await prisma.notification.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(input.unread === true ? { readAt: null } : {}),
      ...(input.unread === false ? { readAt: { not: null } } : {}),
      ...(input.type ? { type: input.type } : {})
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit ?? 30,
    select: {
      id: true,
      workspaceId: true,
      type: true,
      title: true,
      body: true,
      actionUrl: true,
      data: true,
      readAt: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      version: true
    }
  });
  const unreadCount = await prisma.notification.count({
    where: {
      userId,
      readAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    }
  });
  return { items: rows.map(serializeNotification), unreadCount };
}
