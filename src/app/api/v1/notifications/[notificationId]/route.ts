import { prisma } from "@/platform/database/prisma";
import { getRequestId } from "@/platform/http/request";
import {
  NotificationRouteError,
  notificationErrorResponse,
  parseNotificationBody,
  requireNotificationMutation,
  requireNotificationPrincipal
} from "@/modules/notifications/server/route-support";
import { notificationEtag, serializeNotification } from "@/modules/notifications/server/service";
import {
  notificationIdSchema,
  notificationReadSchema
} from "@/modules/notifications/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function missing() {
  return new NotificationRouteError(
    404,
    "not_found",
    "Notification not found",
    "The requested notification is not available."
  );
}

async function target(userId: string, notificationId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, version: true }
  });
  if (!notification) throw missing();
  return notification;
}

function requireVersion(request: Request, id: string, version: number) {
  const etag = notificationEtag(id, version);
  const supplied = request.headers.get("if-match");
  if (!supplied) {
    throw new NotificationRouteError(
      428,
      "precondition_required",
      "Precondition required",
      "Provide the current notification ETag in If-Match."
    );
  }
  if (supplied !== etag) {
    throw new NotificationRouteError(
      412,
      "stale_version",
      "Notification changed",
      "Reload notifications before applying this change.",
      { ETag: etag }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ notificationId: string }> }
) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/notifications/{notificationId}";
  try {
    requireNotificationMutation(request);
    const principal = await requireNotificationPrincipal(request);
    const parsedId = notificationIdSchema.safeParse((await context.params).notificationId);
    if (!parsedId.success) throw missing();
    const current = await target(principal.user.id, parsedId.data);
    requireVersion(request, current.id, current.version);
    const body = await parseNotificationBody(request, notificationReadSchema, instance, requestId);
    if (body instanceof Response) return body;
    const updated = await prisma.notification.update({
      where: { id: current.id },
      data: { readAt: body.read ? new Date() : null, version: { increment: 1 } },
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
    return Response.json(
      { data: serializeNotification(updated), meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: notificationEtag(updated.id, updated.version),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}

export async function DELETE(
  request: Request,
  context: { readonly params: Promise<{ notificationId: string }> }
) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/notifications/{notificationId}";
  try {
    requireNotificationMutation(request);
    const principal = await requireNotificationPrincipal(request);
    const parsedId = notificationIdSchema.safeParse((await context.params).notificationId);
    if (!parsedId.success) throw missing();
    const current = await target(principal.user.id, parsedId.data);
    requireVersion(request, current.id, current.version);
    const removed = await prisma.notification.deleteMany({
      where: { id: current.id, userId: principal.user.id, version: current.version }
    });
    if (removed.count !== 1) {
      throw new NotificationRouteError(
        412,
        "stale_version",
        "Notification changed",
        "Reload notifications before deleting this item."
      );
    }
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId }
    });
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}
