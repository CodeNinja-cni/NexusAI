import { z } from "zod";

import { prisma } from "@/platform/database/prisma";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";
import {
  NotificationRouteError,
  notificationErrorResponse,
  requireNotificationPrincipal
} from "@/modules/notifications/server/route-support";
import { serializeNotification } from "@/modules/notifications/server/service";
import { notificationListQuerySchema } from "@/modules/notifications/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cursorSchema = z.object({
  userId: z.string(),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  unread: z.enum(["true", "false"]).nullable(),
  type: z.string().nullable()
});

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new NotificationRouteError(
      400,
      "invalid_cursor",
      "Invalid cursor",
      "The pagination cursor is invalid for this notification list."
    );
  }
}

function encodeCursor(value: z.infer<typeof cursorSchema>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/notifications";
  try {
    const principal = await requireNotificationPrincipal(request);
    const url = new URL(request.url);
    const parsed = notificationListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return validationProblem(parsed.error, instance, requestId);
    const cursor = decodeCursor(parsed.data.cursor);
    if (
      cursor &&
      (cursor.userId !== principal.user.id ||
        cursor.unread !== (parsed.data.unread ?? null) ||
        cursor.type !== (parsed.data.type ?? null))
    ) {
      throw new NotificationRouteError(
        400,
        "cursor_scope_mismatch",
        "Cursor scope mismatch",
        "The cursor does not belong to this notification query."
      );
    }
    const now = new Date();
    const rows = await prisma.notification.findMany({
      where: {
        userId: principal.user.id,
        ...(parsed.data.unread === "true" ? { readAt: null } : {}),
        ...(parsed.data.unread === "false" ? { readAt: { not: null } } : {}),
        ...(parsed.data.type ? { type: parsed.data.type } : {}),
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: new Date(cursor.createdAt) } },
                    { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }
                  ]
                }
              ]
            : [])
        ]
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: parsed.data.limit + 1,
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
    const hasMore = rows.length > parsed.data.limit;
    const items = rows.slice(0, parsed.data.limit);
    const last = items.at(-1);
    const unreadCount = await prisma.notification.count({
      where: {
        userId: principal.user.id,
        readAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      }
    });
    return Response.json(
      {
        data: items.map(serializeNotification),
        meta: {
          unreadCount,
          nextCursor:
            hasMore && last
              ? encodeCursor({
                  userId: principal.user.id,
                  createdAt: last.createdAt.toISOString(),
                  id: last.id,
                  unread: parsed.data.unread ?? null,
                  type: parsed.data.type ?? null
                })
              : null,
          requestId
        }
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}
