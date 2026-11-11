import "server-only";

import { Prisma, type WorkspaceRole } from "@/generated/prisma/client";
import type { ProviderPromptMessage, ProviderUsage } from "@/modules/chat/server/provider";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";

import {
  calculateEstimatedCostMicros,
  findEffectiveModelPrice,
  type ModelPriceSnapshot
} from "./pricing";

const RESERVATION_GRACE_MS = 10 * 60 * 1000;

export interface UsageQuotaPolicyInput {
  readonly requestLimit: bigint | null;
  readonly inputTokenLimit: bigint | null;
  readonly outputTokenLimit: bigint | null;
  readonly costLimitMicros: bigint | null;
}

export async function reserveAiUsage(
  transaction: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly logicalOperationId: string;
    readonly prompt: readonly ProviderPromptMessage[];
    readonly provider: string;
    readonly model: string;
    readonly reservationDurationMs?: number | undefined;
  }
) {
  const now = new Date();
  await lockWorkspaceUsage(transaction, input.workspaceId);
  const policy = await transaction.workspaceUsagePolicy.upsert({
    where: { workspaceId: input.workspaceId },
    create: { workspaceId: input.workspaceId },
    update: {}
  });
  const period = await getOrCreatePeriod(transaction, input.workspaceId, policy, now);
  await releaseExpiredReservations(transaction, period.id, now);
  const current = await transaction.usageQuotaPeriod.findUniqueOrThrow({
    where: { id: period.id }
  });

  const reservedInputTokens = estimateInputReservation(input.prompt);
  const reservedOutputTokens = BigInt(getServerEnvironment().ai.maxOutputTokens);
  const price = await findEffectiveModelPrice(transaction, input.provider, input.model, now);
  if (current.costLimitMicros !== null && !price) {
    throw new WorkspaceDomainError(
      503,
      "pricing_unavailable",
      "Pricing is required for this quota",
      "The workspace has a cost quota, but no approved effective price exists for this model."
    );
  }
  if (price && price.currency !== current.currency) {
    throw new WorkspaceDomainError(
      503,
      "pricing_currency_mismatch",
      "Pricing currency mismatch",
      "The active model price does not use the workspace quota currency."
    );
  }
  const reservedCostMicros = price
    ? calculateEstimatedCostMicros(
        { inputTokens: reservedInputTokens, outputTokens: reservedOutputTokens },
        price
      )
    : 0n;

  assertWithinLimit(
    "requests",
    current.consumedRequests + current.reservedRequests + 1n,
    current.requestLimit,
    current.periodEnd
  );
  assertWithinLimit(
    "input_tokens",
    current.consumedInputTokens + current.reservedInputTokens + reservedInputTokens,
    current.inputTokenLimit,
    current.periodEnd
  );
  assertWithinLimit(
    "output_tokens",
    current.consumedOutputTokens + current.reservedOutputTokens + reservedOutputTokens,
    current.outputTokenLimit,
    current.periodEnd
  );
  assertWithinLimit(
    "estimated_cost",
    current.consumedCostMicros + current.reservedCostMicros + reservedCostMicros,
    current.costLimitMicros,
    current.periodEnd
  );

  const reservation = await transaction.usageReservation.create({
    data: {
      quotaPeriodId: current.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      modelPriceId: price?.id ?? null,
      logicalOperationId: input.logicalOperationId,
      reservedInputTokens,
      reservedOutputTokens,
      reservedCostMicros,
      expiresAt: new Date(
        now.getTime() +
          (input.reservationDurationMs ?? getServerEnvironment().ai.requestTimeoutMs) +
          RESERVATION_GRACE_MS
      )
    }
  });
  await transaction.usageQuotaPeriod.update({
    where: { id: current.id },
    data: {
      reservedRequests: { increment: 1n },
      reservedInputTokens: { increment: reservedInputTokens },
      reservedOutputTokens: { increment: reservedOutputTokens },
      reservedCostMicros: { increment: reservedCostMicros },
      version: { increment: 1 }
    }
  });

  return { reservation, price };
}

export async function settleAiUsage(
  transaction: Prisma.TransactionClient,
  input: {
    readonly logicalOperationId: string;
    readonly usage?: ProviderUsage | undefined;
    readonly estimatedCostMicros: bigint;
  }
) {
  const initial = await transaction.usageReservation.findUnique({
    where: { logicalOperationId: input.logicalOperationId },
    select: { workspaceId: true }
  });
  if (!initial) return;
  await lockWorkspaceUsage(transaction, initial.workspaceId);
  const reservation = await transaction.usageReservation.findUnique({
    where: { logicalOperationId: input.logicalOperationId }
  });
  if (!reservation || reservation.status === "SETTLED") return;

  const actualInputTokens = BigInt(input.usage?.inputTokens ?? 0);
  const actualOutputTokens = BigInt(input.usage?.outputTokens ?? 0);
  const releaseReserved = reservation.status === "RESERVED";
  await transaction.usageQuotaPeriod.update({
    where: { id: reservation.quotaPeriodId },
    data: {
      ...(releaseReserved
        ? {
            reservedRequests: { decrement: reservation.reservedRequests },
            reservedInputTokens: { decrement: reservation.reservedInputTokens },
            reservedOutputTokens: { decrement: reservation.reservedOutputTokens },
            reservedCostMicros: { decrement: reservation.reservedCostMicros }
          }
        : {}),
      consumedRequests: { increment: 1n },
      consumedInputTokens: { increment: actualInputTokens },
      consumedOutputTokens: { increment: actualOutputTokens },
      consumedCostMicros: { increment: input.estimatedCostMicros },
      version: { increment: 1 }
    }
  });
  await transaction.usageReservation.update({
    where: { id: reservation.id },
    data: {
      status: "SETTLED",
      actualInputTokens,
      actualOutputTokens,
      actualCostMicros: input.estimatedCostMicros,
      settledAt: new Date()
    }
  });
}

export async function releaseAiUsage(
  transaction: Prisma.TransactionClient,
  logicalOperationId: string
) {
  const initial = await transaction.usageReservation.findUnique({
    where: { logicalOperationId },
    select: { workspaceId: true }
  });
  if (!initial) return;
  await lockWorkspaceUsage(transaction, initial.workspaceId);
  const reservation = await transaction.usageReservation.findUnique({
    where: { logicalOperationId }
  });
  if (!reservation || reservation.status !== "RESERVED") return;
  await transaction.usageQuotaPeriod.update({
    where: { id: reservation.quotaPeriodId },
    data: {
      reservedRequests: { decrement: reservation.reservedRequests },
      reservedInputTokens: { decrement: reservation.reservedInputTokens },
      reservedOutputTokens: { decrement: reservation.reservedOutputTokens },
      reservedCostMicros: { decrement: reservation.reservedCostMicros },
      version: { increment: 1 }
    }
  });
  await transaction.usageReservation.update({
    where: { id: reservation.id },
    data: { status: "RELEASED", settledAt: new Date() }
  });
}

export async function getQuotaSnapshot(userId: string, workspaceId: string) {
  const membership = await requireActiveMembership(prisma, userId, workspaceId);
  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    await lockWorkspaceUsage(transaction, workspaceId);
    const policy = await transaction.workspaceUsagePolicy.upsert({
      where: { workspaceId },
      create: { workspaceId },
      update: {}
    });
    const period = await getOrCreatePeriod(transaction, workspaceId, policy, now);
    await releaseExpiredReservations(transaction, period.id, now);
    const current = await transaction.usageQuotaPeriod.findUniqueOrThrow({
      where: { id: period.id }
    });
    return serializeQuotaSnapshot(current, policy.version, membership.role);
  });
}

export async function updateUsageQuotaPolicy(
  userId: string,
  workspaceId: string,
  input: UsageQuotaPolicyInput,
  expectedVersion: number,
  requestId: string
) {
  return prisma.$transaction(
    async (transaction) => {
      const membership = await requireActiveMembership(transaction, userId, workspaceId);
      requireQuotaManager(membership.role);
      await lockWorkspaceUsage(transaction, workspaceId);
      const current = await transaction.workspaceUsagePolicy.upsert({
        where: { workspaceId },
        create: { workspaceId },
        update: {}
      });
      if (current.version !== expectedVersion) {
        throw new WorkspaceDomainError(
          412,
          "stale_version",
          "Quota policy changed",
          "Reload the quota policy before applying this change."
        );
      }
      const policy = await transaction.workspaceUsagePolicy.update({
        where: { workspaceId },
        data: {
          ...input,
          updatedByUserId: userId,
          version: { increment: 1 }
        }
      });
      const now = new Date();
      const period = await getOrCreatePeriod(transaction, workspaceId, policy, now);
      const updatedPeriod = await transaction.usageQuotaPeriod.update({
        where: { id: period.id },
        data: {
          requestLimit: input.requestLimit,
          inputTokenLimit: input.inputTokenLimit,
          outputTokenLimit: input.outputTokenLimit,
          costLimitMicros: input.costLimitMicros,
          policyVersion: policy.version,
          version: { increment: 1 }
        }
      });
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "usage.quota.updated",
          targetType: "WorkspaceUsagePolicy",
          targetId: workspaceId,
          outcome: "SUCCEEDED",
          requestId,
          changes: {
            requestLimit: serializeNullableBigInt(input.requestLimit),
            inputTokenLimit: serializeNullableBigInt(input.inputTokenLimit),
            outputTokenLimit: serializeNullableBigInt(input.outputTokenLimit),
            costLimitMicros: serializeNullableBigInt(input.costLimitMicros),
            version: policy.version
          }
        }
      });
      return serializeQuotaSnapshot(updatedPeriod, policy.version, membership.role);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );
}

export const usagePolicyEtag = (workspaceId: string, version: number) =>
  `"usage-policy:${workspaceId}:${version}"`;

function currentUtcMonth(at: Date) {
  const periodStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

async function getOrCreatePeriod(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  policy: {
    version: number;
    requestLimit: bigint | null;
    inputTokenLimit: bigint | null;
    outputTokenLimit: bigint | null;
    costLimitMicros: bigint | null;
    currency: string;
  },
  at: Date
) {
  const { periodStart, periodEnd } = currentUtcMonth(at);
  return transaction.usageQuotaPeriod.upsert({
    where: { workspaceId_periodStart_periodEnd: { workspaceId, periodStart, periodEnd } },
    create: {
      workspaceId,
      periodStart,
      periodEnd,
      policyVersion: policy.version,
      requestLimit: policy.requestLimit,
      inputTokenLimit: policy.inputTokenLimit,
      outputTokenLimit: policy.outputTokenLimit,
      costLimitMicros: policy.costLimitMicros,
      currency: policy.currency
    },
    update: {}
  });
}

async function releaseExpiredReservations(
  transaction: Prisma.TransactionClient,
  quotaPeriodId: string,
  now: Date
) {
  const expired = await transaction.usageReservation.findMany({
    where: { quotaPeriodId, status: "RESERVED", expiresAt: { lte: now } }
  });
  if (expired.length === 0) return;
  const totals = expired.reduce(
    (sum, item) => ({
      requests: sum.requests + item.reservedRequests,
      input: sum.input + item.reservedInputTokens,
      output: sum.output + item.reservedOutputTokens,
      cost: sum.cost + item.reservedCostMicros
    }),
    { requests: 0n, input: 0n, output: 0n, cost: 0n }
  );
  await transaction.usageReservation.updateMany({
    where: { id: { in: expired.map((item) => item.id) }, status: "RESERVED" },
    data: { status: "RELEASED", settledAt: now }
  });
  await transaction.usageQuotaPeriod.update({
    where: { id: quotaPeriodId },
    data: {
      reservedRequests: { decrement: totals.requests },
      reservedInputTokens: { decrement: totals.input },
      reservedOutputTokens: { decrement: totals.output },
      reservedCostMicros: { decrement: totals.cost },
      version: { increment: 1 }
    }
  });
}

function estimateInputReservation(messages: readonly ProviderPromptMessage[]) {
  const encoder = new TextEncoder();
  return messages.reduce(
    (total, message) => total + BigInt(encoder.encode(message.content).byteLength + 16),
    0n
  );
}

function assertWithinLimit(
  dimension: string,
  projected: bigint,
  limit: bigint | null,
  periodEnd: Date
) {
  if (limit === null || projected <= limit) return;
  const retryAfter = Math.max(1, Math.ceil((periodEnd.getTime() - Date.now()) / 1000));
  throw new WorkspaceDomainError(
    429,
    "quota_exceeded",
    "Workspace usage quota reached",
    `The ${dimension.replaceAll("_", " ")} quota is exhausted for this period.`,
    { "Retry-After": String(retryAfter) }
  );
}

async function lockWorkspaceUsage(transaction: Prisma.TransactionClient, workspaceId: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`usage:${workspaceId}`}, 0))`;
}

async function requireActiveMembership(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string,
  workspaceId: string
) {
  const membership = await client.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
      workspace: { status: "ACTIVE", deletedAt: null }
    },
    select: { role: true }
  });
  if (!membership) {
    throw new WorkspaceDomainError(
      404,
      "not_found",
      "Workspace not found",
      "The requested workspace is not available."
    );
  }
  return membership;
}

function requireQuotaManager(role: WorkspaceRole) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new WorkspaceDomainError(
      403,
      "forbidden",
      "Permission denied",
      "Only workspace Owners and Admins can configure usage quotas."
    );
  }
}

function serializeQuotaSnapshot(
  period: Awaited<ReturnType<typeof getOrCreatePeriod>>,
  policyVersion: number,
  role: WorkspaceRole
) {
  return {
    policyVersion,
    canManage: role === "OWNER" || role === "ADMIN",
    periodStart: period.periodStart.toISOString(),
    periodEnd: period.periodEnd.toISOString(),
    currency: period.currency,
    limits: {
      requests: serializeNullableBigInt(period.requestLimit),
      inputTokens: serializeNullableBigInt(period.inputTokenLimit),
      outputTokens: serializeNullableBigInt(period.outputTokenLimit),
      estimatedCostMicros: serializeNullableBigInt(period.costLimitMicros)
    },
    consumed: {
      requests: period.consumedRequests.toString(),
      inputTokens: period.consumedInputTokens.toString(),
      outputTokens: period.consumedOutputTokens.toString(),
      estimatedCostMicros: period.consumedCostMicros.toString()
    },
    reserved: {
      requests: period.reservedRequests.toString(),
      inputTokens: period.reservedInputTokens.toString(),
      outputTokens: period.reservedOutputTokens.toString(),
      estimatedCostMicros: period.reservedCostMicros.toString()
    },
    remaining: {
      requests: remaining(period.requestLimit, period.consumedRequests, period.reservedRequests),
      inputTokens: remaining(
        period.inputTokenLimit,
        period.consumedInputTokens,
        period.reservedInputTokens
      ),
      outputTokens: remaining(
        period.outputTokenLimit,
        period.consumedOutputTokens,
        period.reservedOutputTokens
      ),
      estimatedCostMicros: remaining(
        period.costLimitMicros,
        period.consumedCostMicros,
        period.reservedCostMicros
      )
    }
  };
}

function remaining(limit: bigint | null, consumed: bigint, reserved: bigint) {
  if (limit === null) return null;
  const value = limit - consumed - reserved;
  return (value > 0n ? value : 0n).toString();
}

function serializeNullableBigInt(value: bigint | null) {
  return value === null ? null : value.toString();
}

export type EffectiveModelPrice = ModelPriceSnapshot;
