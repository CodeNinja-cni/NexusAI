import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/platform/database/prisma";

const PROVISIONING_DEDUPLICATION_PREFIX = "user-provisioning";

function provisioningDeduplicationKey(userId: string) {
  return createHash("sha256")
    .update(`${PROVISIONING_DEDUPLICATION_PREFIX}:${userId}`)
    .digest("hex");
}

function personalWorkspaceName(name: string) {
  const firstName = name.trim().split(/\s+/u)[0] || "Personal";
  return `${firstName.slice(0, 96)}'s workspace`;
}

export async function requestPersonalWorkspaceProvisioning(userId: string): Promise<void> {
  const deduplicationKey = provisioningDeduplicationKey(userId);

  await prisma.$transaction([
    prisma.userProvisioning.upsert({
      where: { userId },
      create: { userId, status: "PENDING" },
      update: {
        status: "PENDING",
        nextAttemptAt: new Date(),
        leaseExpiresAt: null,
        lastErrorCode: null,
        version: { increment: 1 }
      }
    }),
    prisma.outboxEvent.upsert({
      where: { deduplicationKey },
      create: {
        deduplicationKey,
        topic: "user.provision.requested",
        aggregateType: "user",
        aggregateId: userId,
        payload: { userId },
        status: "PENDING"
      },
      update: {
        status: "PENDING",
        availableAt: new Date(),
        lastErrorRedacted: null
      }
    })
  ]);
}

export async function provisionPersonalWorkspace(
  userId: string,
  requestId: string = randomUUID()
): Promise<void> {
  const deduplicationKey = provisioningDeduplicationKey(userId);

  try {
    await prisma.outboxEvent.updateMany({
      where: { deduplicationKey, status: { not: "PUBLISHED" } },
      data: {
        attempts: { increment: 1 },
        availableAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });
    await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;

        const user = await transaction.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, emailVerified: true, status: true }
        });

        if (!user || !user.emailVerified || user.status !== "ACTIVE") {
          throw new Error("user_not_eligible");
        }

        const currentProvisioning = await transaction.userProvisioning.findUnique({
          where: { userId },
          select: { personalWorkspaceId: true, status: true }
        });

        if (currentProvisioning?.status === "READY" && currentProvisioning.personalWorkspaceId) {
          await transaction.outboxEvent.updateMany({
            where: { deduplicationKey },
            data: {
              status: "PUBLISHED",
              publishedAt: new Date(),
              lastErrorRedacted: null
            }
          });
          return;
        }

        const existingProvisioning = await transaction.userProvisioning.upsert({
          where: { userId },
          create: { userId, status: "RUNNING", attemptCount: 1 },
          update: {
            status: "RUNNING",
            attemptCount: { increment: 1 },
            leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
            lastErrorCode: null,
            version: { increment: 1 }
          },
          select: { personalWorkspaceId: true, status: true }
        });

        let workspace = existingProvisioning.personalWorkspaceId
          ? await transaction.workspace.findUnique({
              where: { id: existingProvisioning.personalWorkspaceId }
            })
          : await transaction.workspace.findFirst({
              where: {
                ownerUserId: userId,
                kind: "PERSONAL",
                deletedAt: null
              }
            });

        workspace ??= await transaction.workspace.create({
          data: {
            kind: "PERSONAL",
            name: personalWorkspaceName(user.name),
            ownerUserId: userId,
            createdByUserId: userId
          }
        });

        await transaction.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: workspace.id,
              userId
            }
          },
          create: {
            workspaceId: workspace.id,
            userId,
            role: "OWNER"
          },
          update: { role: "OWNER", version: { increment: 1 } }
        });

        await transaction.workspaceStorageQuota.upsert({
          where: { workspaceId: workspace.id },
          create: { workspaceId: workspace.id },
          update: {}
        });

        await transaction.workspaceUsagePolicy.upsert({
          where: { workspaceId: workspace.id },
          create: { workspaceId: workspace.id },
          update: {}
        });

        await transaction.userPreference.upsert({
          where: { userId },
          create: { userId, defaultWorkspaceId: workspace.id },
          update: {
            defaultWorkspaceId: workspace.id,
            version: { increment: 1 }
          }
        });

        await transaction.userProvisioning.update({
          where: { userId },
          data: {
            status: "READY",
            personalWorkspaceId: workspace.id,
            readyAt: new Date(),
            nextAttemptAt: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            version: { increment: 1 }
          }
        });

        await transaction.auditLog.create({
          data: {
            workspaceId: workspace.id,
            actorUserId: userId,
            actorKind: "USER",
            action: "personal_workspace.provisioned",
            targetType: "workspace",
            targetId: workspace.id,
            outcome: "SUCCEEDED",
            requestId,
            metadata: { kind: "PERSONAL" }
          }
        });

        await transaction.outboxEvent.updateMany({
          where: { deduplicationKey },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            lastErrorRedacted: null
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch {
    await Promise.allSettled([
      prisma.userProvisioning.updateMany({
        where: { userId },
        data: {
          status: "FAILED",
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + 60_000),
          lastErrorCode: "provisioning_failed",
          version: { increment: 1 }
        }
      }),
      prisma.outboxEvent.updateMany({
        where: { deduplicationKey },
        data: {
          status: "FAILED",
          availableAt: new Date(Date.now() + 60_000),
          lastErrorRedacted: "provisioning_failed"
        }
      })
    ]);
  }
}
