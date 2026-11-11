import { z } from "zod";

import { requestAccountDeletion } from "@/modules/settings/server/account-deletion";
import { accountDeletionRequestSchema } from "@/modules/settings/server/validation";
import {
  notificationErrorResponse,
  parseNotificationBody,
  requireNotificationMutation,
  requireNotificationPrincipal
} from "@/modules/notifications/server/route-support";
import { prisma } from "@/platform/database/prisma";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/me/deletion-request";
  try {
    const principal = await requireNotificationPrincipal(request);
    const deletion = await prisma.accountDeletionRequest.findFirst({
      where: { userId: principal.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        scheduledFor: true,
        cancelledAt: true,
        startedAt: true,
        completedAt: true,
        failedAt: true,
        failureCode: true,
        version: true
      }
    });
    if (!deletion) {
      return Response.json(
        {
          type: "https://nexus.local/problems/not-found",
          title: "Deletion request not found",
          status: 404,
          detail: "No account deletion request exists.",
          instance,
          code: "not_found",
          requestId
        },
        {
          status: 404,
          headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId }
        }
      );
    }
    return Response.json(
      { data: deletion, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/me/deletion-request";
  try {
    requireNotificationMutation(request);
    const principal = await requireNotificationPrincipal(request);
    const idempotencyKey = z.uuid().safeParse(request.headers.get("idempotency-key"));
    if (!idempotencyKey.success)
      return validationProblem(idempotencyKey.error, instance, requestId);
    const body = await parseNotificationBody(
      request,
      accountDeletionRequestSchema,
      instance,
      requestId
    );
    if (body instanceof Response) return body;
    const result = await requestAccountDeletion({
      principal,
      headers: request.headers,
      password: body.password,
      requestId
    });
    return Response.json(
      { data: result, meta: { requestId, idempotencyKey: idempotencyKey.data } },
      { status: 202, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}
