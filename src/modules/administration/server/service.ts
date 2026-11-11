import "server-only";

import { createHash } from "node:crypto";

import { Prisma, type UserStatus } from "@/generated/prisma/client";
import { prisma } from "@/platform/database/prisma";

import { AdministrationError } from "./route-support";
import {
  isPlatformSettingKey,
  parseAdminRange,
  platformSettingSchemas,
  type PlatformSettingKey
} from "./validation";

const DAY_MS = 24 * 60 * 60 * 1000;

type UserListInput = {
  readonly query?: string | undefined;
  readonly status?: UserStatus | undefined;
  readonly platformRole?: "USER" | "ADMIN" | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
};

export async function getAdminDashboard(actorUserId: string, requestId: string) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const previousStart = new Date(now.getTime() - 60 * DAY_MS);
  const lastDay = new Date(now.getTime() - DAY_MS);
  const [
    users,
    workspaces,
    activeSessions,
    usageCurrent,
    usagePrevious,
    failedOutbox,
    failedDocuments,
    failedWorkflows,
    recentAudits
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.workspace.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.session.count({ where: { expiresAt: { gt: now } } }),
    prisma.usageRecord.aggregate({
      where: { occurredAt: { gte: thirtyDaysAgo, lt: now } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicros: true }
    }),
    prisma.usageRecord.aggregate({
      where: { occurredAt: { gte: previousStart, lt: thirtyDaysAgo } },
      _count: { _all: true }
    }),
    prisma.outboxEvent.count({ where: { status: "FAILED" } }),
    prisma.documentProcessingRun.count({
      where: { status: { in: ["FAILED", "QUARANTINED"] }, createdAt: { gte: lastDay } }
    }),
    prisma.workflowExecution.count({
      where: { status: { in: ["FAILED", "TIMED_OUT"] }, createdAt: { gte: lastDay } }
    }),
    prisma.auditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        action: true,
        outcome: true,
        actorKind: true,
        targetType: true,
        targetId: true,
        createdAt: true
      }
    })
  ]);
  await recordAdminRead(actorUserId, "admin.dashboard.viewed", "platform", null, requestId, {});
  return {
    generatedAt: now.toISOString(),
    users: Object.fromEntries(users.map((row) => [row.status, row._count._all])),
    workspaces: Object.fromEntries(workspaces.map((row) => [row.status, row._count._all])),
    activeSessions,
    usage: {
      rangeDays: 30,
      requests: usageCurrent._count._all,
      previousRequests: usagePrevious._count._all,
      inputTokens: (usageCurrent._sum.inputTokens ?? 0n).toString(),
      outputTokens: (usageCurrent._sum.outputTokens ?? 0n).toString(),
      estimatedCostMicros: (usageCurrent._sum.estimatedCostMicros ?? 0n).toString(),
      currency: "USD"
    },
    attention: { failedOutbox, failedDocuments, failedWorkflows },
    recentActivity: recentAudits.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString()
    }))
  };
}

export async function listAdminUsers(actorUserId: string, input: UserListInput, requestId: string) {
  const now = new Date();
  const scope = fingerprint({
    query: input.query?.toLowerCase(),
    status: input.status,
    platformRole: input.platformRole,
    from: input.from,
    to: input.to
  });
  const cursor = input.cursor ? decodeCursor(input.cursor, scope) : null;
  const from = input.from ? new Date(input.from) : undefined;
  const to = input.to ? new Date(input.to) : undefined;
  const items = await prisma.user.findMany({
    where: {
      ...(input.query
        ? {
            OR: [
              { name: { contains: input.query, mode: "insensitive" as const } },
              { email: { contains: input.query, mode: "insensitive" as const } }
            ]
          }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.platformRole ? { platformRole: input.platformRole } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } }
            ]
          }
        : {})
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      platformRole: true,
      status: true,
      twoFactorEnabled: true,
      createdAt: true,
      updatedAt: true,
      version: true,
      _count: {
        select: {
          memberships: true,
          sessions: { where: { expiresAt: { gt: now } } }
        }
      }
    }
  });
  await recordAdminRead(actorUserId, "admin.users.listed", "user_collection", null, requestId, {
    queryUsed: Boolean(input.query),
    status: input.status ?? null,
    platformRole: input.platformRole ?? null
  });
  const page = items.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      memberships: user._count.memberships,
      activeSessions: user._count.sessions,
      _count: undefined
    })),
    nextCursor:
      items.length > input.limit && last ? encodeCursor(scope, last.createdAt, last.id) : null
  };
}

export async function getAdminUser(actorUserId: string, userId: string, requestId: string) {
  const now = new Date();
  const [user, usage] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        platformRole: true,
        status: true,
        twoFactorEnabled: true,
        suspendedAt: true,
        deletionRequestedAt: true,
        createdAt: true,
        updatedAt: true,
        version: true,
        provisioning: { select: { status: true } },
        memberships: {
          select: { role: true, workspace: { select: { id: true, kind: true, status: true } } }
        },
        sessions: {
          where: { expiresAt: { gt: now } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            mfaVerifiedAt: true,
            ipAddress: true,
            userAgent: true
          }
        }
      }
    }),
    prisma.usageRecord.aggregate({
      where: { userId },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicros: true }
    })
  ]);
  if (!user) throw notFound("User");
  await recordAdminRead(actorUserId, "admin.user.viewed", "user", userId, requestId, {});
  return {
    ...user,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    suspendedAt: user.suspendedAt?.toISOString() ?? null,
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    sessions: user.sessions.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      mfaVerifiedAt: session.mfaVerifiedAt?.toISOString() ?? null
    })),
    usage: {
      requests: usage._count._all,
      inputTokens: (usage._sum.inputTokens ?? 0n).toString(),
      outputTokens: (usage._sum.outputTokens ?? 0n).toString(),
      estimatedCostMicros: (usage._sum.estimatedCostMicros ?? 0n).toString(),
      currency: "USD"
    }
  };
}

export async function updateAdminUser(
  actorUserId: string,
  userId: string,
  input: {
    readonly platformRole?: "USER" | "ADMIN" | undefined;
    readonly status?: "ACTIVE" | "SUSPENDED" | undefined;
    readonly version: number;
    readonly reason: string;
  },
  requestId: string
) {
  if (actorUserId === userId) {
    throw new AdministrationError(
      409,
      "self_admin_mutation_denied",
      "Self-administration denied",
      "Another active platform administrator must change your role or status."
    );
  }
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "users"
        WHERE "platform_role" = 'ADMIN' AND "status" = 'ACTIVE' AND "deleted_at" IS NULL
        FOR UPDATE
      `);
      const target = await transaction.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          platformRole: true,
          status: true,
          twoFactorEnabled: true,
          twoFactor: { select: { verified: true } },
          deletedAt: true,
          version: true
        }
      });
      if (!target) throw notFound("User");
      if (!(["ACTIVE", "SUSPENDED"] as UserStatus[]).includes(target.status)) {
        throw new AdministrationError(
          409,
          "governed_status_required",
          "Governed account state",
          "Deletion states can only be changed by the governed account-deletion process."
        );
      }
      if (target.version !== input.version) throw staleVersion();
      const nextRole = input.platformRole ?? target.platformRole;
      const nextStatus = input.status ?? target.status;
      if (nextRole === target.platformRole && nextStatus === target.status) {
        throw new AdministrationError(
          409,
          "no_change",
          "No change requested",
          "Choose a role or status different from the current value."
        );
      }
      if (
        nextRole === "ADMIN" &&
        nextStatus === "ACTIVE" &&
        (!target.emailVerified || !target.twoFactorEnabled || !target.twoFactor?.verified)
      ) {
        throw new AdministrationError(
          422,
          "admin_mfa_enrollment_required",
          "Administrator enrollment incomplete",
          "A platform administrator must be active, email-verified, and enrolled in multi-factor authentication."
        );
      }
      if (
        target.platformRole === "ADMIN" &&
        target.status === "ACTIVE" &&
        (nextRole !== "ADMIN" || nextStatus !== "ACTIVE")
      ) {
        const activeAdmins = await transaction.user.count({
          where: { platformRole: "ADMIN", status: "ACTIVE", deletedAt: null }
        });
        if (activeAdmins <= 1) {
          throw new AdministrationError(
            409,
            "last_active_admin",
            "Last administrator protected",
            "Promote another enrolled administrator before removing this account's access."
          );
        }
      }
      const updated = await transaction.user.updateMany({
        where: { id: userId, version: input.version },
        data: {
          platformRole: nextRole,
          status: nextStatus,
          suspendedAt: nextStatus === "SUSPENDED" ? new Date() : null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw staleVersion();
      await transaction.session.deleteMany({ where: { userId } });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          actorKind: "PLATFORM_ADMIN",
          action: "admin.user.access_changed",
          targetType: "user",
          targetId: userId,
          outcome: "SUCCEEDED",
          requestId,
          changes: {
            platformRole: { from: target.platformRole, to: nextRole },
            status: { from: target.status, to: nextStatus }
          },
          metadata: { reason: input.reason, sessionsRevoked: true }
        }
      });
      const result = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          platformRole: true,
          status: true,
          twoFactorEnabled: true,
          version: true,
          updatedAt: true
        }
      });
      return { ...result, updatedAt: result.updatedAt.toISOString() };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function revokeAdminUserSessions(
  actorUserId: string,
  userId: string,
  sessionIds: readonly string[] | undefined,
  reason: string,
  requestId: string
) {
  if (actorUserId === userId) {
    throw new AdministrationError(
      409,
      "self_session_revocation_denied",
      "Self-revocation denied",
      "Use Security settings to revoke your own sessions."
    );
  }
  return prisma.$transaction(async (transaction) => {
    const target = await transaction.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });
    if (!target) throw notFound("User");
    const result = await transaction.session.deleteMany({
      where: { userId, ...(sessionIds ? { id: { in: [...sessionIds] } } : {}) }
    });
    await transaction.auditLog.create({
      data: {
        actorUserId,
        actorKind: "PLATFORM_ADMIN",
        action: "admin.user.sessions_revoked",
        targetType: "user",
        targetId: userId,
        outcome: "SUCCEEDED",
        requestId,
        changes: { revokedSessionCount: result.count },
        metadata: { reason, scope: sessionIds ? "SELECTED" : "ALL" }
      }
    });
    return { revokedSessionCount: result.count };
  });
}

export async function getAdminUsageSummary(
  actorUserId: string,
  input: AdminRangeInput & {
    readonly groupBy: "day" | "provider" | "model" | "operation";
  },
  requestId: string
) {
  const range = parseAdminRange(input);
  const [totals, breakdown] = await Promise.all([
    prisma.usageRecord.aggregate({
      where: { occurredAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicros: true }
    }),
    aggregatePlatformUsage(range.from, range.to, input.groupBy)
  ]);
  await recordAdminRead(actorUserId, "admin.usage.summary_viewed", "usage", null, requestId, {
    groupBy: input.groupBy,
    from: range.from.toISOString(),
    to: range.to.toISOString()
  });
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    groupBy: input.groupBy,
    totals: {
      requests: totals._count._all,
      inputTokens: (totals._sum.inputTokens ?? 0n).toString(),
      outputTokens: (totals._sum.outputTokens ?? 0n).toString(),
      estimatedCostMicros: (totals._sum.estimatedCostMicros ?? 0n).toString(),
      currency: "USD"
    },
    breakdown: breakdown.map((row) => ({
      bucket: row.bucket instanceof Date ? row.bucket.toISOString() : row.bucket,
      requests: Number(row.requests),
      inputTokens: row.inputTokens.toString(),
      outputTokens: row.outputTokens.toString(),
      estimatedCostMicros: row.estimatedCostMicros.toString()
    }))
  };
}

export async function listAdminUsageRecords(
  actorUserId: string,
  input: AdminRangeInput & {
    readonly provider?: string | undefined;
    readonly model?: string | undefined;
    readonly operation?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit: number;
  },
  requestId: string
) {
  const range = parseAdminRange(input);
  const scope = fingerprint({
    from: range.from,
    to: range.to,
    provider: input.provider,
    model: input.model,
    operation: input.operation
  });
  const cursor = input.cursor ? decodeCursor(input.cursor, scope) : null;
  const records = await prisma.usageRecord.findMany({
    where: {
      occurredAt: { gte: range.from, lt: range.to },
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.operation ? { operation: input.operation } : {}),
      ...(cursor
        ? {
            OR: [
              { occurredAt: { lt: cursor.createdAt } },
              { occurredAt: cursor.createdAt, id: { lt: cursor.id } }
            ]
          }
        : {})
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      id: true,
      workspaceId: true,
      userId: true,
      operation: true,
      provider: true,
      model: true,
      status: true,
      usageSource: true,
      pricingStatus: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostMicros: true,
      currency: true,
      latencyMs: true,
      occurredAt: true
    }
  });
  await recordAdminRead(
    actorUserId,
    "admin.usage.records_viewed",
    "usage_record_collection",
    null,
    requestId,
    { filtered: Boolean(input.provider || input.model || input.operation) }
  );
  const page = records.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((record) => ({
      ...record,
      inputTokens: record.inputTokens.toString(),
      outputTokens: record.outputTokens.toString(),
      estimatedCostMicros: record.estimatedCostMicros.toString(),
      occurredAt: record.occurredAt.toISOString()
    })),
    nextCursor:
      records.length > input.limit && last ? encodeCursor(scope, last.occurredAt, last.id) : null
  };
}

export async function listAdminActivity(
  actorUserId: string,
  input: {
    readonly limit: number;
    readonly outcome?: "SUCCEEDED" | "FAILED" | "DENIED" | undefined;
  },
  requestId: string
) {
  const [audits, outbox, documentRuns, workflowRuns] = await Promise.all([
    prisma.auditLog.findMany({
      where: input.outcome ? { outcome: input.outcome } : {},
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: {
        id: true,
        action: true,
        outcome: true,
        targetType: true,
        targetId: true,
        actorKind: true,
        createdAt: true
      }
    }),
    prisma.outboxEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        topic: true,
        aggregateType: true,
        aggregateId: true,
        status: true,
        attempts: true,
        createdAt: true
      }
    }),
    prisma.documentProcessingRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, documentId: true, status: true, attempt: true, createdAt: true }
    }),
    prisma.workflowExecution.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, workflowId: true, status: true, createdAt: true }
    })
  ]);
  await recordAdminRead(
    actorUserId,
    "admin.system_activity.viewed",
    "system_activity",
    null,
    requestId,
    {}
  );
  return [
    ...audits.map((item) => ({
      id: item.id,
      source: "AUDIT",
      event: item.action,
      status: item.outcome,
      targetType: item.targetType,
      targetId: item.targetId,
      actorKind: item.actorKind,
      createdAt: item.createdAt.toISOString()
    })),
    ...outbox.map((item) => ({
      id: item.id,
      source: "OUTBOX",
      event: item.topic,
      status: item.status,
      targetType: item.aggregateType,
      targetId: item.aggregateId,
      attempts: item.attempts,
      createdAt: item.createdAt.toISOString()
    })),
    ...documentRuns.map((item) => ({
      id: item.id,
      source: "DOCUMENT",
      event: "document.processing",
      status: item.status,
      targetType: "document",
      targetId: item.documentId,
      attempts: item.attempt,
      createdAt: item.createdAt.toISOString()
    })),
    ...workflowRuns.map((item) => ({
      id: item.id,
      source: "WORKFLOW",
      event: "workflow.execution",
      status: item.status,
      targetType: "workflow",
      targetId: item.workflowId,
      createdAt: item.createdAt.toISOString()
    }))
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, input.limit);
}

export async function listAdminAuditLogs(
  actorUserId: string,
  input: {
    readonly actorUserId?: string | undefined;
    readonly workspaceId?: string | undefined;
    readonly action?: string | undefined;
    readonly targetType?: string | undefined;
    readonly targetId?: string | undefined;
    readonly outcome?: string | undefined;
    readonly requestId?: string | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit: number;
  },
  accessRequestId: string
) {
  const scope = fingerprint(input);
  const cursor = input.cursor ? decodeCursor(input.cursor, scope) : null;
  const logs = await prisma.auditLog.findMany({
    where: {
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.from || input.to
        ? {
            createdAt: {
              ...(input.from ? { gte: new Date(input.from) } : {}),
              ...(input.to ? { lt: new Date(input.to) } : {})
            }
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } }
            ]
          }
        : {})
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      id: true,
      workspaceId: true,
      actorUserId: true,
      actorKind: true,
      action: true,
      targetType: true,
      targetId: true,
      outcome: true,
      requestId: true,
      changes: true,
      metadata: true,
      createdAt: true
    }
  });
  await recordAdminRead(
    actorUserId,
    "admin.audit_logs.viewed",
    "audit_log_collection",
    null,
    accessRequestId,
    { filtersUsed: Object.values(input).filter(Boolean).length - 1 }
  );
  const page = logs.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((log) => ({
      ...log,
      changes: redactJson(log.changes),
      metadata: redactJson(log.metadata),
      createdAt: log.createdAt.toISOString()
    })),
    nextCursor:
      logs.length > input.limit && last ? encodeCursor(scope, last.createdAt, last.id) : null
  };
}

const settingDescriptions: Record<PlatformSettingKey, string> = {
  user_registration:
    "Controls whether public email-and-password registration accepts new accounts.",
  maintenance_notice: "Stores the safe public maintenance notice state. It never stores secrets.",
  admin_operations:
    "Controls administration reporting defaults and failed-job attention thresholds."
};

export async function listPlatformSettings(actorUserId: string, requestId: string) {
  const settings = await prisma.platformSetting.findMany({ orderBy: { key: "asc" } });
  await recordAdminRead(
    actorUserId,
    "admin.platform_settings.viewed",
    "platform_setting_collection",
    null,
    requestId,
    {}
  );
  return settings.flatMap((setting) => {
    if (!isPlatformSettingKey(setting.key)) return [];
    return [
      {
        key: setting.key,
        value: setting.value,
        description: settingDescriptions[setting.key],
        schemaVersion: setting.schemaVersion,
        version: setting.version,
        updatedAt: setting.updatedAt.toISOString(),
        etag: `\"${setting.version}\"`
      }
    ];
  });
}

export async function updatePlatformSetting(
  actorUserId: string,
  key: string,
  value: unknown,
  reason: string,
  expectedVersion: number,
  requestId: string
) {
  if (!isPlatformSettingKey(key)) throw notFound("Platform setting");
  const parsed = platformSettingSchemas[key].safeParse(value);
  if (!parsed.success) {
    throw new AdministrationError(
      422,
      "invalid_setting",
      "Invalid platform setting",
      parsed.error.issues[0]?.message ?? "The setting value is invalid."
    );
  }
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.platformSetting.findUnique({ where: { key } });
    if (!current) throw notFound("Platform setting");
    if (current.version !== expectedVersion) throw staleVersion();
    const updated = await transaction.platformSetting.updateMany({
      where: { key, version: expectedVersion },
      data: { value: parsed.data, updatedByUserId: actorUserId, version: { increment: 1 } }
    });
    if (updated.count !== 1) throw staleVersion();
    await transaction.auditLog.create({
      data: {
        actorUserId,
        actorKind: "PLATFORM_ADMIN",
        action: "admin.platform_setting.changed",
        targetType: "platform_setting",
        targetId: key,
        outcome: "SUCCEEDED",
        requestId,
        changes: { from: current.value, to: parsed.data },
        metadata: { reason, schemaVersion: current.schemaVersion }
      }
    });
    const result = await transaction.platformSetting.findUniqueOrThrow({ where: { key } });
    return {
      key: result.key,
      value: result.value,
      schemaVersion: result.schemaVersion,
      version: result.version,
      updatedAt: result.updatedAt.toISOString()
    };
  });
}

interface AggregateRow {
  bucket: string | Date;
  requests: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  estimatedCostMicros: bigint;
}

function aggregatePlatformUsage(
  from: Date,
  to: Date,
  groupBy: "day" | "provider" | "model" | "operation"
) {
  const bucket =
    groupBy === "day"
      ? Prisma.sql`date_trunc('day', "occurred_at")`
      : groupBy === "provider"
        ? Prisma.sql`"provider"`
        : groupBy === "model"
          ? Prisma.sql`"model"`
          : Prisma.sql`"operation"`;
  return prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    SELECT ${bucket} AS "bucket",
      count(*)::bigint AS "requests",
      COALESCE(sum("input_tokens"), 0)::bigint AS "inputTokens",
      COALESCE(sum("output_tokens"), 0)::bigint AS "outputTokens",
      COALESCE(sum("estimated_cost_micros"), 0)::bigint AS "estimatedCostMicros"
    FROM "usage_records"
    WHERE "occurred_at" >= ${from} AND "occurred_at" < ${to}
    GROUP BY ${bucket}
    ORDER BY ${groupBy === "day" ? bucket : Prisma.sql`count(*)`} ${Prisma.raw(groupBy === "day" ? "ASC" : "DESC")}
    LIMIT 200
  `);
}

async function recordAdminRead(
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  requestId: string,
  metadata: Prisma.InputJsonValue
) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      actorKind: "PLATFORM_ADMIN",
      action,
      targetType,
      targetId,
      outcome: "SUCCEEDED",
      requestId,
      metadata
    }
  });
}

function redactJson(value: Prisma.JsonValue): Prisma.JsonValue {
  if (Array.isArray(value)) return value.slice(0, 50).map(redactJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !/(token|secret|password|prompt|content|storageKey|authorization)/iu.test(key)
        )
        .slice(0, 50)
        .map(([key, entry]) => [key, redactJson(entry ?? null)])
    );
  }
  return typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

function notFound(subject: string) {
  return new AdministrationError(
    404,
    "not_found",
    `${subject} not found`,
    `The requested ${subject.toLowerCase()} is not available.`
  );
}

function staleVersion() {
  return new AdministrationError(
    412,
    "precondition_failed",
    "Resource changed",
    "Reload the resource and retry with its current version."
  );
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function encodeCursor(scope: string, createdAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ scope, createdAt: createdAt.toISOString(), id }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(value: string, scope: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      scope?: unknown;
      createdAt?: unknown;
      id?: unknown;
    };
    const createdAt = new Date(String(parsed.createdAt));
    if (
      parsed.scope !== scope ||
      typeof parsed.id !== "string" ||
      parsed.id.length > 255 ||
      !Number.isFinite(createdAt.getTime())
    )
      throw new Error("invalid cursor");
    return { createdAt, id: parsed.id };
  } catch {
    throw new AdministrationError(
      400,
      "invalid_cursor",
      "Invalid cursor",
      "The cursor is invalid or belongs to another administrative query."
    );
  }
}

interface AdminRangeInput {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}
