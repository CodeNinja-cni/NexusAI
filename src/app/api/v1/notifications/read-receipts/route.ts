import { z } from "zod";

import { prisma } from "@/platform/database/prisma";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";
import {
  notificationErrorResponse,
  parseNotificationBody,
  requireNotificationMutation,
  requireNotificationPrincipal
} from "@/modules/notifications/server/route-support";
import { notificationReceiptSchema } from "@/modules/notifications/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idempotencyKeySchema = z.uuid();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/notifications/read-receipts";
  try {
    requireNotificationMutation(request);
    const principal = await requireNotificationPrincipal(request);
    const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) {
      return validationProblem(key.error, instance, requestId);
    }
    const body = await parseNotificationBody(
      request,
      notificationReceiptSchema,
      instance,
      requestId
    );
    if (body instanceof Response) return body;
    const where = {
      userId: principal.user.id,
      ...(body.notificationIds ? { id: { in: body.notificationIds } } : {}),
      ...(body.allBefore ? { createdAt: { lte: new Date(body.allBefore) } } : {})
    };
    const count = await prisma.$transaction(async (transaction) => {
      const total = await transaction.notification.count({ where });
      await transaction.notification.updateMany({
        where: { ...where, readAt: null },
        data: { readAt: new Date(), version: { increment: 1 } }
      });
      return total;
    });
    return Response.json(
      { data: { count }, meta: { requestId, idempotencyKey: key.data } },
      {
        headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId }
      }
    );
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}
