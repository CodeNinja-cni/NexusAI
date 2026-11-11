import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { APIError } from "better-auth/api";
import { Prisma } from "@/generated/prisma/client";

import { auth } from "@/modules/auth/server/auth";
import type { RequestPrincipal } from "@/modules/auth/server/session";
import { createNotification } from "@/modules/notifications/server/service";
import { NotificationRouteError } from "@/modules/notifications/server/route-support";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { getObjectStorage } from "@/platform/storage";

const ACCOUNT_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;
const LEASE_MS = 10 * 60 * 1_000;

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function subjectHash(userId: string) {
  return createHmac("sha256", getServerEnvironment().betterAuthSecret)
    .update(`account-deletion:${userId}`)
    .digest("hex");
}

export async function requestAccountDeletion(input: {
  readonly principal: RequestPrincipal;
  readonly headers: Headers;
  readonly password: string;
  readonly requestId: string;
}) {
  const sessionCreatedAt = new Date(input.principal.session.createdAt).getTime();
  if (!Number.isFinite(sessionCreatedAt) || Date.now() - sessionCreatedAt > 10 * 60 * 1_000) {
    throw new NotificationRouteError(
      403,
      "fresh_authentication_required",
      "Recent authentication required",
      "Sign in again before requesting account deletion."
    );
  }
  try {
    await auth.api.verifyPassword({ headers: input.headers, body: { password: input.password } });
  } catch (error) {
    if (error instanceof APIError) {
      throw new NotificationRouteError(
        422,
        "password_not_accepted",
        "Password not accepted",
        "The current password was not accepted."
      );
    }
    throw error;
  }

  const rawToken = randomBytes(32).toString("base64url");
  const requestedAt = new Date();
  const minimumSchedule = new Date(requestedAt.getTime() + ACCOUNT_GRACE_MS);

  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.principal.user.id}, 0))`;
      const user = await transaction.user.findUnique({
        where: { id: input.principal.user.id },
        select: { id: true, name: true, email: true, status: true }
      });
      if (!user || user.status !== "ACTIVE") {
        throw new NotificationRouteError(
          409,
          "account_unavailable",
          "Account unavailable",
          "This account cannot enter deletion now."
        );
      }
      const ownedTeams = await transaction.workspace.findMany({
        where: { ownerUserId: user.id, kind: "TEAM" },
        select: { id: true, name: true, status: true, deletedAt: true, purgeAfter: true }
      });
      const unresolved = ownedTeams.filter(
        (workspace) => workspace.status !== "PENDING_DELETION" || !workspace.deletedAt
      );
      if (unresolved.length) {
        throw new NotificationRouteError(
          409,
          "ownership_resolution_required",
          "Workspace ownership must be resolved",
          `Transfer or schedule deletion for ${unresolved.length} owned team workspace${unresolved.length === 1 ? "" : "s"} first.`
        );
      }
      const scheduledFor = ownedTeams.reduce(
        (latest, workspace) =>
          workspace.purgeAfter && workspace.purgeAfter > latest ? workspace.purgeAfter : latest,
        minimumSchedule
      );
      const request = await transaction.accountDeletionRequest.create({
        data: {
          userId: user.id,
          subjectIdHash: subjectHash(user.id),
          status: "PENDING",
          requestedAt,
          scheduledFor,
          cancellationTokenDigest: tokenDigest(rawToken),
          cancellationExpiresAt: scheduledFor,
          nextAttemptAt: scheduledFor,
          manifest: {
            schemaVersion: "account-deletion-v1",
            ownedTeamWorkspaceIds: ownedTeams.map((workspace) => workspace.id)
          }
        }
      });
      await transaction.user.update({
        where: { id: user.id },
        data: {
          status: "PENDING_DELETION",
          deletionRequestedAt: requestedAt,
          version: { increment: 1 }
        }
      });
      await transaction.session.deleteMany({ where: { userId: user.id } });
      const cancellationUrl = `${getServerEnvironment().appBaseUrl}/account-deletion/cancel?token=${encodeURIComponent(rawToken)}`;
      await transaction.outboxEvent.create({
        data: {
          deduplicationKey: createHash("sha256")
            .update(`account-deletion-email:${request.id}`)
            .digest("hex"),
          topic: "auth.email.send",
          aggregateType: "account_deletion_request",
          aggregateId: request.id,
          payload: {
            template: "ACCOUNT_DELETION_CANCELLATION",
            to: user.email,
            name: user.name,
            url: cancellationUrl,
            scheduledFor: scheduledFor.toISOString()
          }
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: user.id,
          actorKind: "USER",
          action: "account_deletion.requested",
          targetType: "account_deletion_request",
          targetId: request.id,
          outcome: "SUCCEEDED",
          requestId: input.requestId,
          metadata: {
            scheduledFor: scheduledFor.toISOString(),
            ownedTeamWorkspaceCount: ownedTeams.length
          }
        }
      });
      return { id: request.id, status: request.status, scheduledFor: scheduledFor.toISOString() };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function cancelAccountDeletion(token: string, requestId: string) {
  const digest = tokenDigest(token);
  return prisma.$transaction(
    async (transaction) => {
      const request = await transaction.accountDeletionRequest.findUnique({
        where: { cancellationTokenDigest: digest },
        include: { user: { select: { id: true } } }
      });
      if (
        !request?.user ||
        !["PENDING", "FAILED"].includes(request.status) ||
        !request.cancellationExpiresAt ||
        request.cancellationExpiresAt <= new Date() ||
        request.startedAt
      ) {
        throw new NotificationRouteError(
          410,
          "deletion_cancellation_unavailable",
          "Cancellation unavailable",
          "This cancellation link is invalid, expired, or deletion has already begun."
        );
      }
      await transaction.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationTokenDigest: null,
          cancellationExpiresAt: null,
          nextAttemptAt: null,
          leaseExpiresAt: null,
          version: { increment: 1 }
        }
      });
      await transaction.user.update({
        where: { id: request.user.id },
        data: { status: "ACTIVE", deletionRequestedAt: null, version: { increment: 1 } }
      });
      await createNotification(transaction, {
        userId: request.user.id,
        type: "SYSTEM_ALERT",
        title: "Account deletion cancelled",
        body: "Your account is active again. Sign in and reset your password if you did not request deletion.",
        actionUrl: "/settings/security",
        data: { event: "ACCOUNT_DELETION_CANCELLED" },
        eventKey: `account-deletion:${request.id}:cancelled`
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.user.id,
          actorKind: "USER",
          action: "account_deletion.cancelled",
          targetType: "account_deletion_request",
          targetId: request.id,
          outcome: "SUCCEEDED",
          requestId
        }
      });
      return { status: "CANCELLED" as const };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function processDueAccountDeletions(limit = 10) {
  const due = await prisma.accountDeletionRequest.findMany({
    where: {
      status: { in: ["PENDING", "FAILED", "RUNNING"] },
      scheduledFor: { lte: new Date() },
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: new Date() } },
        { status: "RUNNING", leaseExpiresAt: { lte: new Date() } }
      ]
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: { id: true }
  });
  for (const candidate of due) await processAccountDeletion(candidate.id);
  return due.length;
}

async function processAccountDeletion(requestId: string) {
  const claimed = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`;
    const request = await transaction.accountDeletionRequest.findUnique({
      where: { id: requestId }
    });
    if (!request?.userId || request.scheduledFor > new Date()) return null;
    const retryable =
      request.status === "PENDING" ||
      request.status === "FAILED" ||
      (request.status === "RUNNING" &&
        request.leaseExpiresAt &&
        request.leaseExpiresAt <= new Date());
    if (!retryable) return null;
    const updated = await transaction.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: "RUNNING",
        startedAt: request.startedAt ?? new Date(),
        failedAt: null,
        failureCode: null,
        attemptCount: { increment: 1 },
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        version: { increment: 1 }
      }
    });
    return { request: updated, userId: request.userId };
  });
  if (!claimed) return;
  try {
    const ownedWorkspaces = await prisma.workspace.findMany({
      where: {
        ownerUserId: claimed.userId,
        OR: [
          { kind: "PERSONAL" },
          { kind: "TEAM", status: "PENDING_DELETION", purgeAfter: { lte: new Date() } }
        ]
      },
      select: { id: true, documents: { select: { storageKey: true } } }
    });
    for (const workspace of ownedWorkspaces) {
      for (const document of workspace.documents) {
        await getObjectStorage().deleteObject(document.storageKey);
      }
    }
    await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`;
        const request = await transaction.accountDeletionRequest.findUniqueOrThrow({
          where: { id: requestId }
        });
        if (request.status !== "RUNNING" || request.userId !== claimed.userId) return;
        const unresolvedTeam = await transaction.workspace.count({
          where: {
            ownerUserId: claimed.userId,
            kind: "TEAM",
            OR: [
              { status: { not: "PENDING_DELETION" } },
              { purgeAfter: null },
              { purgeAfter: { gt: new Date() } }
            ]
          }
        });
        if (unresolvedTeam) throw new Error("ownership_resolution_required");
        await transaction.workspace.deleteMany({ where: { ownerUserId: claimed.userId } });
        await transaction.accountDeletionRequest.update({
          where: { id: requestId },
          data: {
            status: "COMPLETED",
            userId: null,
            completedAt: new Date(),
            cancellationTokenDigest: null,
            cancellationExpiresAt: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            manifest: {
              schemaVersion: "account-deletion-v1",
              databasePurged: true,
              objectsPurged: true
            },
            version: { increment: 1 }
          }
        });
        await transaction.user.delete({ where: { id: claimed.userId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch {
    await prisma.accountDeletionRequest.updateMany({
      where: { id: requestId, status: "RUNNING" },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        failureCode: "account_deletion_failed",
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + 15 * 60 * 1_000),
        version: { increment: 1 }
      }
    });
  }
}
