import "server-only";

import { Prisma, type WorkspaceRole } from "@/generated/prisma/client";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";
import { prisma } from "@/platform/database/prisma";

export interface UsageRange {
  readonly from: Date;
  readonly to: Date;
}

type UsageGroupBy = "day" | "model" | "operation";

interface AggregateRow {
  bucket: Date | string;
  requestCount: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  estimatedCostMicros: bigint;
  pricedCount: bigint;
  unpricedCount: bigint;
}

export async function getUsageSummary(
  userId: string,
  workspaceId: string,
  range: UsageRange,
  groupBy: UsageGroupBy
) {
  await requireUsageMembership(userId, workspaceId);
  const where = { workspaceId, occurredAt: { gte: range.from, lt: range.to } };
  const [totals, unavailableUsageCount, developmentEstimateCount, breakdown] = await Promise.all([
    prisma.usageRecord.aggregate({
      where,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicros: true }
    }),
    prisma.usageRecord.count({ where: { ...where, usageSource: "UNAVAILABLE" } }),
    prisma.usageRecord.count({ where: { ...where, usageSource: "DEVELOPMENT_ESTIMATE" } }),
    aggregateBreakdown(workspaceId, range, groupBy)
  ]);
  const pricedCount = await prisma.usageRecord.count({
    where: { ...where, pricingStatus: "PRICED" }
  });
  const requestCount = totals._count._all;

  return {
    workspaceId,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    groupBy,
    totals: {
      aiRequests: requestCount,
      inputTokens: (totals._sum.inputTokens ?? 0n).toString(),
      outputTokens: (totals._sum.outputTokens ?? 0n).toString(),
      estimatedCostMicros: (totals._sum.estimatedCostMicros ?? 0n).toString(),
      pricedRequests: pricedCount,
      unpricedRequests: requestCount - pricedCount,
      unavailableUsageRequests: unavailableUsageCount,
      developmentEstimateRequests: developmentEstimateCount,
      currency: "USD"
    },
    breakdown: breakdown.map(serializeAggregateRow)
  };
}

export async function listUsageRecords(
  userId: string,
  workspaceId: string,
  input: UsageRange & {
    readonly provider?: string | undefined;
    readonly model?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit: number;
  }
) {
  const membership = await requireUsageMembership(userId, workspaceId);
  const canViewWorkspaceRecords = membership.role === "OWNER" || membership.role === "ADMIN";
  const cursor = input.cursor
    ? decodeCursor(input.cursor, workspaceId, canViewWorkspaceRecords ? "workspace" : userId)
    : null;
  const records = await prisma.usageRecord.findMany({
    where: {
      workspaceId,
      ...(!canViewWorkspaceRecords ? { userId } : {}),
      occurredAt: {
        gte: input.from,
        lt: input.to,
        ...(cursor ? { lte: cursor.occurredAt } : {})
      },
      ...(cursor
        ? {
            OR: [
              { occurredAt: { lt: cursor.occurredAt } },
              { occurredAt: cursor.occurredAt, id: { lt: cursor.id } }
            ]
          }
        : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {})
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      id: true,
      operationId: true,
      operation: true,
      provider: true,
      model: true,
      status: true,
      usageSource: true,
      inputTokens: true,
      outputTokens: true,
      cachedInputTokens: true,
      reasoningTokens: true,
      estimatedCostMicros: true,
      currency: true,
      pricingVersion: true,
      pricingStatus: true,
      providerRequestId: true,
      occurredAt: true,
      latencyMs: true
    }
  });
  const page = records.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((record) => ({
      ...record,
      inputTokens: record.inputTokens.toString(),
      outputTokens: record.outputTokens.toString(),
      cachedInputTokens: record.cachedInputTokens?.toString() ?? null,
      reasoningTokens: record.reasoningTokens?.toString() ?? null,
      estimatedCostMicros: record.estimatedCostMicros.toString(),
      occurredAt: record.occurredAt.toISOString()
    })),
    nextCursor:
      records.length > input.limit && last
        ? encodeCursor({
            workspaceId,
            scope: canViewWorkspaceRecords ? "workspace" : userId,
            occurredAt: last.occurredAt.toISOString(),
            id: last.id
          })
        : null,
    scope: canViewWorkspaceRecords ? "workspace" : "self"
  };
}

export async function getUsagePageData(userId: string, workspaceId: string, range: UsageRange) {
  const [summary, records] = await Promise.all([
    getUsageSummary(userId, workspaceId, range, "day"),
    listUsageRecords(userId, workspaceId, { ...range, limit: 8 })
  ]);
  return { summary, records };
}

async function aggregateBreakdown(
  workspaceId: string,
  range: UsageRange,
  groupBy: UsageGroupBy
): Promise<AggregateRow[]> {
  if (groupBy === "day") {
    return prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        date_trunc('day', "occurred_at") AS "bucket",
        count(*)::bigint AS "requestCount",
        COALESCE(sum("input_tokens"), 0)::bigint AS "inputTokens",
        COALESCE(sum("output_tokens"), 0)::bigint AS "outputTokens",
        COALESCE(sum("estimated_cost_micros"), 0)::bigint AS "estimatedCostMicros",
        count(*) FILTER (WHERE "pricing_status" = 'PRICED')::bigint AS "pricedCount",
        count(*) FILTER (WHERE "pricing_status" = 'UNPRICED')::bigint AS "unpricedCount"
      FROM "usage_records"
      WHERE "workspace_id" = CAST(${workspaceId} AS uuid)
        AND "occurred_at" >= ${range.from}
        AND "occurred_at" < ${range.to}
      GROUP BY date_trunc('day', "occurred_at")
      ORDER BY "bucket" ASC
    `);
  }
  const column = groupBy === "model" ? Prisma.sql`"model"` : Prisma.sql`"operation"`;
  return prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    SELECT
      ${column} AS "bucket",
      count(*)::bigint AS "requestCount",
      COALESCE(sum("input_tokens"), 0)::bigint AS "inputTokens",
      COALESCE(sum("output_tokens"), 0)::bigint AS "outputTokens",
      COALESCE(sum("estimated_cost_micros"), 0)::bigint AS "estimatedCostMicros",
      count(*) FILTER (WHERE "pricing_status" = 'PRICED')::bigint AS "pricedCount",
      count(*) FILTER (WHERE "pricing_status" = 'UNPRICED')::bigint AS "unpricedCount"
    FROM "usage_records"
    WHERE "workspace_id" = CAST(${workspaceId} AS uuid)
      AND "occurred_at" >= ${range.from}
      AND "occurred_at" < ${range.to}
    GROUP BY ${column}
    ORDER BY "requestCount" DESC, "bucket" ASC
  `);
}

function serializeAggregateRow(row: AggregateRow) {
  return {
    bucket: row.bucket instanceof Date ? row.bucket.toISOString() : row.bucket,
    aiRequests: Number(row.requestCount),
    inputTokens: row.inputTokens.toString(),
    outputTokens: row.outputTokens.toString(),
    estimatedCostMicros: row.estimatedCostMicros.toString(),
    pricedRequests: Number(row.pricedCount),
    unpricedRequests: Number(row.unpricedCount)
  };
}

async function requireUsageMembership(userId: string, workspaceId: string) {
  const membership = await prisma.workspaceMember.findUnique({
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
  return membership as { role: WorkspaceRole };
}

interface UsageCursor {
  readonly workspaceId: string;
  readonly scope: string;
  readonly occurredAt: string;
  readonly id: string;
}

function encodeCursor(cursor: UsageCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string, workspaceId: string, scope: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as UsageCursor;
    const occurredAt = new Date(parsed.occurredAt);
    if (
      parsed.workspaceId !== workspaceId ||
      parsed.scope !== scope ||
      !Number.isFinite(occurredAt.getTime()) ||
      !/^[0-9a-f-]{36}$/iu.test(parsed.id)
    ) {
      throw new Error("scope mismatch");
    }
    return { occurredAt, id: parsed.id };
  } catch {
    throw new WorkspaceDomainError(
      400,
      "invalid_cursor",
      "Invalid cursor",
      "The usage cursor is invalid or belongs to another scope."
    );
  }
}
