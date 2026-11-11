import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/platform/database/prisma";

const RECENT_RESOURCE_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 6;
const USAGE_WINDOW_DAYS = 30;

export async function getDashboardData(userId: string, workspaceId: string) {
  const usageFrom = new Date(Date.now() - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return prisma.$transaction(
    async (transaction) => {
      const membership = await transaction.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId, userId },
          workspace: { status: "ACTIVE", deletedAt: null }
        },
        select: {
          role: true,
          joinedAt: true,
          workspace: {
            select: {
              id: true,
              name: true,
              kind: true,
              createdAt: true,
              updatedAt: true,
              storageQuota: {
                select: {
                  byteLimit: true,
                  documentLimit: true,
                  usedBytes: true,
                  reservedBytes: true,
                  documentCount: true,
                  reservedDocumentCount: true
                }
              },
              _count: { select: { members: true } }
            }
          }
        }
      });

      if (!membership) return null;

      const [
        recentConversations,
        conversationCount,
        recentDocuments,
        documentCount,
        usageCount,
        unpricedUsageCount,
        usageTotals,
        recentActivity
      ] = await Promise.all([
        transaction.conversation.findMany({
          where: { workspaceId, deletedAt: null },
          orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
          take: RECENT_RESOURCE_LIMIT,
          select: {
            id: true,
            title: true,
            status: true,
            modelKey: true,
            lastMessageAt: true,
            updatedAt: true
          }
        }),
        transaction.conversation.count({ where: { workspaceId, deletedAt: null } }),
        transaction.document.findMany({
          where: { workspaceId, deletedAt: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: RECENT_RESOURCE_LIMIT,
          select: {
            id: true,
            name: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            createdAt: true,
            processedAt: true
          }
        }),
        transaction.document.count({ where: { workspaceId, deletedAt: null } }),
        transaction.usageRecord.count({ where: { workspaceId, occurredAt: { gte: usageFrom } } }),
        transaction.usageRecord.count({
          where: {
            workspaceId,
            occurredAt: { gte: usageFrom },
            pricingStatus: "UNPRICED"
          }
        }),
        transaction.usageRecord.aggregate({
          where: { workspaceId, occurredAt: { gte: usageFrom } },
          _sum: {
            inputTokens: true,
            outputTokens: true,
            estimatedCostMicros: true
          }
        }),
        transaction.auditLog.findMany({
          where: { workspaceId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: RECENT_ACTIVITY_LIMIT,
          select: {
            id: true,
            action: true,
            targetType: true,
            outcome: true,
            createdAt: true
          }
        })
      ]);

      return {
        workspace: {
          id: membership.workspace.id,
          name: membership.workspace.name,
          kind: membership.workspace.kind,
          role: membership.role,
          memberCount: membership.workspace._count.members,
          createdAt: membership.workspace.createdAt,
          updatedAt: membership.workspace.updatedAt,
          joinedAt: membership.joinedAt,
          storageQuota: membership.workspace.storageQuota
        },
        usage: {
          from: usageFrom,
          operationCount: usageCount,
          unpricedOperationCount: unpricedUsageCount,
          inputTokens: usageTotals._sum.inputTokens ?? 0n,
          outputTokens: usageTotals._sum.outputTokens ?? 0n,
          estimatedCostMicros: usageTotals._sum.estimatedCostMicros ?? 0n
        },
        conversationCount,
        documentCount,
        recentConversations,
        recentDocuments,
        recentActivity
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

export type DashboardData = NonNullable<Awaited<ReturnType<typeof getDashboardData>>>;
