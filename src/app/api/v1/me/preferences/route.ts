import { listEnabledChatModels } from "@/modules/chat/server/model-catalog";
import {
  NotificationRouteError,
  notificationErrorResponse,
  parseNotificationBody,
  requireNotificationMutation,
  requireNotificationPrincipal
} from "@/modules/notifications/server/route-support";
import {
  aiPreferencesSchema,
  notificationPreferencesSchema,
  preferenceUpdateSchema
} from "@/modules/settings/server/validation";
import { prisma } from "@/platform/database/prisma";
import { getRequestId } from "@/platform/http/request";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function preferenceEtag(userId: string, version: number) {
  return `"user-preference:${userId}:${version}"`;
}

function serializePreference(value: {
  userId: string;
  theme: string;
  locale: string;
  timeZone: string;
  defaultWorkspaceId: string | null;
  defaultModelKey: string | null;
  aiPreferences: unknown;
  notificationPreferences: unknown;
  version: number;
}) {
  return {
    ...value,
    aiPreferences: aiPreferencesSchema
      .catch({
        responseStyle: "BALANCED",
        includeSources: true,
        explainCode: true
      })
      .parse(value.aiPreferences),
    notificationPreferences: notificationPreferencesSchema
      .catch({
        newActivity: true,
        documentProcessing: true,
        workflowStatus: true
      })
      .parse(value.notificationPreferences),
    etag: preferenceEtag(value.userId, value.version)
  };
}

async function preference(userId: string) {
  return prisma.userPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: {
      userId: true,
      theme: true,
      locale: true,
      timeZone: true,
      defaultWorkspaceId: true,
      defaultModelKey: true,
      aiPreferences: true,
      notificationPreferences: true,
      version: true
    }
  });
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/me/preferences";
  try {
    const principal = await requireNotificationPrincipal(request);
    const value = await preference(principal.user.id);
    return Response.json(
      { data: serializePreference(value), meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: preferenceEtag(value.userId, value.version),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/me/preferences";
  try {
    requireNotificationMutation(request);
    const principal = await requireNotificationPrincipal(request);
    const current = await preference(principal.user.id);
    const expectedEtag = preferenceEtag(current.userId, current.version);
    const supplied = request.headers.get("if-match");
    if (!supplied) {
      throw new NotificationRouteError(
        428,
        "precondition_required",
        "Precondition required",
        "Provide the current preference ETag in If-Match."
      );
    }
    if (supplied !== expectedEtag) {
      throw new NotificationRouteError(
        412,
        "stale_version",
        "Preferences changed",
        "Reload settings before saving again.",
        { ETag: expectedEtag }
      );
    }
    const body = await parseNotificationBody(request, preferenceUpdateSchema, instance, requestId);
    if (body instanceof Response) return body;
    if (body.defaultModelKey) {
      const enabled = listEnabledChatModels().some((model) => model.key === body.defaultModelKey);
      if (!enabled) {
        throw new NotificationRouteError(
          422,
          "unsupported_model",
          "Model unavailable",
          "Choose an enabled model from the current deployment."
        );
      }
    }
    if (body.defaultWorkspaceId) {
      const membership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: body.defaultWorkspaceId,
            userId: principal.user.id
          },
          workspace: { status: "ACTIVE", deletedAt: null }
        },
        select: { id: true }
      });
      if (!membership) {
        throw new NotificationRouteError(
          422,
          "workspace_unavailable",
          "Workspace unavailable",
          "Choose a workspace you can currently access."
        );
      }
    }
    const updated = await prisma.$transaction(async (transaction) => {
      const updateData: Prisma.UserPreferenceUncheckedUpdateManyInput = {
        ...(body.theme !== undefined ? { theme: body.theme } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.timeZone !== undefined ? { timeZone: body.timeZone } : {}),
        ...(body.defaultWorkspaceId !== undefined
          ? { defaultWorkspaceId: body.defaultWorkspaceId }
          : {}),
        ...(body.defaultModelKey !== undefined ? { defaultModelKey: body.defaultModelKey } : {}),
        ...(body.aiPreferences !== undefined ? { aiPreferences: body.aiPreferences } : {}),
        ...(body.notificationPreferences !== undefined
          ? { notificationPreferences: body.notificationPreferences }
          : {}),
        version: { increment: 1 }
      };
      const changed = await transaction.userPreference.updateMany({
        where: { userId: principal.user.id, version: current.version },
        data: updateData
      });
      if (changed.count !== 1) {
        throw new NotificationRouteError(
          412,
          "stale_version",
          "Preferences changed",
          "Reload settings before saving again."
        );
      }
      const value = await transaction.userPreference.findUniqueOrThrow({
        where: { userId: principal.user.id },
        select: {
          userId: true,
          theme: true,
          locale: true,
          timeZone: true,
          defaultWorkspaceId: true,
          defaultModelKey: true,
          aiPreferences: true,
          notificationPreferences: true,
          version: true
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: principal.user.id,
          actorKind: "USER",
          action: "preferences.updated",
          targetType: "user_preference",
          targetId: principal.user.id,
          outcome: "SUCCEEDED",
          requestId,
          changes: { fields: Object.keys(body) }
        }
      });
      return value;
    });
    return Response.json(
      { data: serializePreference(updated), meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: preferenceEtag(updated.userId, updated.version),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}
