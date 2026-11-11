import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { Prisma, type WorkspaceRole } from "@/generated/prisma/client";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { createNotification } from "@/modules/notifications/server/service";

import { capabilitiesFor, hasWorkspaceCapability, mayInviteRole, mayRemoveMember } from "./policy";
import { WorkspaceDomainError } from "./route-support";

const WORKSPACE_RECOVERY_DAYS = 30;
const INVITATION_LIFETIME_DAYS = 7;
const listLimit = 100;

const workspaceSelect = {
  id: true,
  kind: true,
  name: true,
  slug: true,
  ownerUserId: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  purgeAfter: true,
  purgeStartedAt: true,
  _count: { select: { members: true } }
} satisfies Prisma.WorkspaceSelect;

function workspaceData<T extends { role: WorkspaceRole; workspace: WorkspaceWithCount }>(value: T) {
  const { _count, ...workspace } = value.workspace;
  return {
    ...workspace,
    role: value.role,
    memberCount: _count.members,
    capabilities: capabilitiesFor(value.role, value.workspace.kind)
  };
}

type WorkspaceWithCount = Prisma.WorkspaceGetPayload<{ select: typeof workspaceSelect }>;

function inaccessible() {
  return new WorkspaceDomainError(
    404,
    "not_found",
    "Workspace not found",
    "The requested workspace is not available."
  );
}

function wrongKind() {
  return new WorkspaceDomainError(
    409,
    "workspace_kind_forbidden",
    "Team workspace required",
    "This operation is not available for a personal workspace."
  );
}

function forbidden(detail = "Your workspace role does not allow this operation.") {
  return new WorkspaceDomainError(403, "forbidden", "Permission denied", detail);
}

function slugConflict() {
  return new WorkspaceDomainError(
    409,
    "workspace_slug_conflict",
    "Workspace slug unavailable",
    "Choose a different workspace slug."
  );
}

async function withUniqueConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw slugConflict();
    }
    throw error;
  }
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
      const delay = 10 * 2 ** attempt + Math.floor(Math.random() * 10);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("serializable_retry_exhausted");
}

async function activeMembership(
  userId: string,
  workspaceId: string,
  transaction: Prisma.TransactionClient | typeof prisma = prisma
) {
  const membership = await transaction.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
      workspace: { status: "ACTIVE", deletedAt: null }
    },
    select: { id: true, role: true, version: true, workspace: { select: workspaceSelect } }
  });
  if (!membership) throw inaccessible();
  return membership;
}

export async function listWorkspaces(userId: string) {
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      userId,
      OR: [
        { workspace: { status: "ACTIVE", deletedAt: null } },
        {
          role: "OWNER",
          workspace: {
            ownerUserId: userId,
            status: "PENDING_DELETION",
            deletedAt: { not: null }
          }
        }
      ]
    },
    orderBy: [{ workspace: { status: "asc" } }, { joinedAt: "asc" }],
    take: listLimit,
    select: { role: true, joinedAt: true, workspace: { select: workspaceSelect } }
  });

  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { defaultWorkspaceId: true }
  });

  return {
    items: memberships.map((membership) => ({
      ...workspaceData(membership),
      joinedAt: membership.joinedAt,
      selected: membership.workspace.id === preference?.defaultWorkspaceId
    })),
    selectedWorkspaceId: preference?.defaultWorkspaceId ?? null
  };
}

export async function getActiveWorkspaceId(userId: string, personalWorkspaceId: string | null) {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { defaultWorkspaceId: true }
  });
  const candidates = [preference?.defaultWorkspaceId, personalWorkspaceId].filter(
    (value): value is string => Boolean(value)
  );

  for (const workspaceId of candidates) {
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
        workspace: { status: "ACTIVE", deletedAt: null }
      },
      select: { id: true }
    });
    if (membership) return workspaceId;
  }

  const fallback = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { status: "ACTIVE", deletedAt: null } },
    orderBy: { joinedAt: "asc" },
    select: { workspaceId: true }
  });
  return fallback?.workspaceId ?? null;
}

export async function createTeamWorkspace(
  userId: string,
  input: { name: string; slug?: string | undefined },
  requestId: string
) {
  return withUniqueConflict(() =>
    prisma.$transaction(async (transaction) => {
      const workspace = await transaction.workspace.create({
        data: {
          kind: "TEAM",
          name: input.name,
          ...(input.slug ? { slug: input.slug } : {}),
          ownerUserId: userId,
          createdByUserId: userId,
          members: { create: { userId, role: "OWNER" } },
          storageQuota: { create: {} },
          usagePolicy: { create: {} }
        },
        select: workspaceSelect
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: userId,
          actorKind: "USER",
          action: "workspace.created",
          targetType: "workspace",
          targetId: workspace.id,
          outcome: "SUCCEEDED",
          requestId,
          metadata: { kind: "TEAM" }
        }
      });
      return workspaceData({ role: "OWNER", workspace });
    })
  );
}

export async function getWorkspace(userId: string, workspaceId: string) {
  return workspaceData(await activeMembership(userId, workspaceId));
}

export async function renameWorkspace(
  userId: string,
  workspaceId: string,
  input: { name?: string | undefined; slug?: string | null | undefined },
  expectedVersion: number,
  requestId: string
) {
  return withUniqueConflict(() =>
    prisma.$transaction(async (transaction) => {
      const membership = await activeMembership(userId, workspaceId, transaction);
      if (!hasWorkspaceCapability(membership.role, membership.workspace.kind, "workspace:update")) {
        throw forbidden();
      }
      const updated = await transaction.workspace.updateMany({
        where: { id: workspaceId, version: expectedVersion, status: "ACTIVE", deletedAt: null },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new WorkspaceDomainError(
          412,
          "stale_version",
          "Workspace changed",
          "Reload the workspace before applying this change."
        );
      }
      const workspace = await transaction.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: workspaceSelect
      });
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "workspace.updated",
          targetType: "workspace",
          targetId: workspaceId,
          outcome: "SUCCEEDED",
          requestId,
          changes: { fields: Object.keys(input) }
        }
      });
      return workspaceData({ role: membership.role, workspace });
    })
  );
}

export async function selectWorkspace(userId: string, workspaceId: string, requestId: string) {
  const membership = await activeMembership(userId, workspaceId);
  await prisma.$transaction([
    prisma.userPreference.upsert({
      where: { userId },
      create: { userId, defaultWorkspaceId: workspaceId },
      update: { defaultWorkspaceId: workspaceId, version: { increment: 1 } }
    }),
    prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: userId,
        actorKind: "USER",
        action: "workspace.selected",
        targetType: "workspace",
        targetId: workspaceId,
        outcome: "SUCCEEDED",
        requestId
      }
    })
  ]);
  return workspaceData(membership);
}

export async function deleteWorkspace(
  userId: string,
  workspaceId: string,
  expectedVersion: number,
  requestId: string
) {
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
      const membership = await activeMembership(userId, workspaceId, transaction);
      if (membership.workspace.kind !== "TEAM") throw wrongKind();
      if (membership.role !== "OWNER" || membership.workspace.ownerUserId !== userId) {
        throw forbidden("Only the workspace Owner can schedule deletion.");
      }
      if (membership.workspace.version !== expectedVersion) {
        throw new WorkspaceDomainError(
          412,
          "stale_version",
          "Workspace changed",
          "Reload the workspace before applying this change."
        );
      }
      const deletedAt = new Date();
      const purgeAfter = new Date(
        deletedAt.getTime() + WORKSPACE_RECOVERY_DAYS * 24 * 60 * 60 * 1000
      );
      const workspace = await transaction.workspace.update({
        where: { id: workspaceId },
        data: {
          status: "PENDING_DELETION",
          deletedAt,
          purgeAfter,
          version: { increment: 1 }
        },
        select: workspaceSelect
      });
      await transaction.userPreference.updateMany({
        where: { defaultWorkspaceId: workspaceId },
        data: { defaultWorkspaceId: null, version: { increment: 1 } }
      });
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "workspace.deletion_scheduled",
          targetType: "workspace",
          targetId: workspaceId,
          outcome: "SUCCEEDED",
          requestId,
          metadata: { purgeAfter: purgeAfter.toISOString() }
        }
      });
      return workspaceData({ role: membership.role, workspace });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function restoreWorkspace(userId: string, workspaceId: string, requestId: string) {
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
      const membership = await transaction.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true, workspace: { select: workspaceSelect } }
      });
      if (!membership) throw inaccessible();
      if (membership.workspace.kind !== "TEAM") throw wrongKind();
      if (membership.role !== "OWNER" || membership.workspace.ownerUserId !== userId) {
        throw inaccessible();
      }
      if (membership.workspace.status === "ACTIVE" && !membership.workspace.deletedAt) {
        return workspaceData(membership);
      }
      const now = new Date();
      if (
        membership.workspace.purgeStartedAt ||
        !membership.workspace.purgeAfter ||
        membership.workspace.purgeAfter <= now
      ) {
        throw new WorkspaceDomainError(
          409,
          "recovery_window_closed",
          "Recovery window closed",
          "This workspace can no longer be restored."
        );
      }
      const workspace = await transaction.workspace.update({
        where: { id: workspaceId },
        data: {
          status: "ACTIVE",
          deletedAt: null,
          purgeAfter: null,
          purgeStartedAt: null,
          version: { increment: 1 }
        },
        select: workspaceSelect
      });
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "workspace.restored",
          targetType: "workspace",
          targetId: workspaceId,
          outcome: "SUCCEEDED",
          requestId
        }
      });
      return workspaceData({ role: membership.role, workspace });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function listMembers(userId: string, workspaceId: string) {
  const membership = await activeMembership(userId, workspaceId);
  const items = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    take: listLimit,
    select: {
      id: true,
      userId: true,
      role: true,
      joinedAt: true,
      version: true,
      user: { select: { name: true, email: true, image: true } }
    }
  });
  return { callerRole: membership.role, items };
}

export async function updateMemberRole(
  userId: string,
  workspaceId: string,
  targetUserId: string,
  role: "ADMIN" | "MEMBER",
  expectedVersion: number,
  requestId: string
) {
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
      const actor = await activeMembership(userId, workspaceId, transaction);
      if (actor.workspace.kind !== "TEAM") throw wrongKind();
      if (actor.role !== "OWNER") throw forbidden("Only the Owner can manage Admin roles.");
      const target = await transaction.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        select: { id: true, role: true, version: true, userId: true }
      });
      if (!target) throw inaccessible();
      if (target.role === "OWNER" || target.userId === userId) {
        throw forbidden("Ownership can change only through an ownership transfer.");
      }
      if (target.version !== expectedVersion) {
        throw new WorkspaceDomainError(
          412,
          "stale_version",
          "Member changed",
          "Reload the member list."
        );
      }
      const updated = await transaction.workspaceMember.update({
        where: { id: target.id },
        data: { role, version: { increment: 1 } },
        select: { id: true, userId: true, role: true, joinedAt: true, version: true }
      });
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "workspace_member.role_changed",
          targetType: "workspace_member",
          targetId: target.id,
          outcome: "SUCCEEDED",
          requestId,
          changes: { from: target.role, to: role }
        }
      });
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function removeMember(
  userId: string,
  workspaceId: string,
  targetUserId: string,
  expectedVersion: number,
  requestId: string
) {
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
      const actor = await activeMembership(userId, workspaceId, transaction);
      if (actor.workspace.kind !== "TEAM") throw wrongKind();
      const target = await transaction.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        select: { id: true, userId: true, role: true, version: true }
      });
      if (!target) throw inaccessible();
      if (!mayRemoveMember(userId, actor.role, target.userId, target.role)) throw forbidden();
      if (target.version !== expectedVersion) {
        throw new WorkspaceDomainError(
          412,
          "stale_version",
          "Member changed",
          "Reload the member list."
        );
      }
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: target.userId === userId ? "workspace_member.left" : "workspace_member.removed",
          targetType: "workspace_member",
          targetId: target.id,
          outcome: "SUCCEEDED",
          requestId,
          metadata: { targetRole: target.role }
        }
      });
      await transaction.workspaceMember.delete({ where: { id: target.id } });
      await transaction.userPreference.updateMany({
        where: { userId: target.userId, defaultWorkspaceId: workspaceId },
        data: { defaultWorkspaceId: null, version: { increment: 1 } }
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function listInvitations(userId: string, workspaceId: string) {
  const membership = await activeMembership(userId, workspaceId);
  if (membership.workspace.kind !== "TEAM") throw wrongKind();
  if (membership.role === "MEMBER") throw forbidden();
  const now = new Date();
  await prisma.workspaceInvitation.updateMany({
    where: { workspaceId, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", closedAt: now, version: { increment: 1 } }
  });
  const invitations = await prisma.workspaceInvitation.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: listLimit,
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      version: true
    }
  });
  return invitations.map((invitation) => ({
    ...invitation,
    role: invitation.role as "ADMIN" | "MEMBER"
  }));
}

export async function createInvitation(
  userId: string,
  workspaceId: string,
  input: { email: string; role: "ADMIN" | "MEMBER" },
  requestId: string
) {
  const normalizedEmail = input.email.toLowerCase();
  const rawToken = randomBytes(32).toString("base64url");
  const tokenDigest = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
    const actor = await activeMembership(userId, workspaceId, transaction);
    if (actor.workspace.kind !== "TEAM") throw wrongKind();
    if (!mayInviteRole(actor.role, input.role)) throw forbidden();

    const existingMember = await transaction.workspaceMember.findFirst({
      where: { workspaceId, user: { email: normalizedEmail } },
      select: { id: true }
    });
    if (existingMember) return { accepted: true } as const;

    const now = new Date();
    await transaction.workspaceInvitation.updateMany({
      where: { workspaceId, email: normalizedEmail, status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED", closedAt: now, version: { increment: 1 } }
    });
    const existing = await transaction.workspaceInvitation.findFirst({
      where: { workspaceId, email: normalizedEmail, status: "PENDING" },
      select: { id: true }
    });
    const invitation = existing
      ? await transaction.workspaceInvitation.update({
          where: { id: existing.id },
          data: {
            role: input.role,
            tokenDigest,
            expiresAt,
            invitedByUserId: userId,
            version: { increment: 1 }
          },
          select: { id: true }
        })
      : await transaction.workspaceInvitation.create({
          data: {
            workspaceId,
            email: normalizedEmail,
            role: input.role,
            tokenDigest,
            invitedByUserId: userId,
            expiresAt
          },
          select: { id: true }
        });
    const actorUser = await transaction.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true }
    });
    const url = `${getServerEnvironment().appBaseUrl}/workspace/invitations/accept#token=${encodeURIComponent(rawToken)}`;
    await transaction.outboxEvent.create({
      data: {
        deduplicationKey: createHash("sha256")
          .update(`workspace-invitation:${invitation.id}:${tokenDigest}`)
          .digest("hex"),
        topic: "workspace.invitation.email.send",
        aggregateType: "workspace_invitation",
        aggregateId: invitation.id,
        workspaceId,
        payload: {
          template: "WORKSPACE_INVITATION",
          to: normalizedEmail,
          name: normalizedEmail,
          inviterName: actorUser.name,
          workspaceName: actor.workspace.name,
          url
        }
      }
    });
    await transaction.auditLog.create({
      data: {
        workspaceId,
        actorUserId: userId,
        actorKind: "USER",
        action: existing ? "workspace_invitation.resent" : "workspace_invitation.created",
        targetType: "workspace_invitation",
        targetId: invitation.id,
        outcome: "SUCCEEDED",
        requestId,
        metadata: { role: input.role }
      }
    });
    return { accepted: true } as const;
  });
}

export async function revokeInvitation(
  userId: string,
  workspaceId: string,
  invitationId: string,
  expectedVersion: number,
  requestId: string
) {
  await prisma.$transaction(async (transaction) => {
    const actor = await activeMembership(userId, workspaceId, transaction);
    if (actor.workspace.kind !== "TEAM") throw wrongKind();
    if (actor.role === "MEMBER") throw forbidden();
    const invitation = await transaction.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId },
      select: { id: true, role: true, status: true, version: true }
    });
    if (!invitation) throw inaccessible();
    if (actor.role === "ADMIN" && invitation.role !== "MEMBER") throw forbidden();
    if (invitation.version !== expectedVersion) {
      throw new WorkspaceDomainError(
        412,
        "stale_version",
        "Invitation changed",
        "Reload invitations."
      );
    }
    if (invitation.status !== "PENDING") {
      throw new WorkspaceDomainError(
        409,
        "invitation_closed",
        "Invitation already closed",
        "Only a pending invitation can be revoked."
      );
    }
    await transaction.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED", closedAt: new Date(), version: { increment: 1 } }
    });
    await transaction.auditLog.create({
      data: {
        workspaceId,
        actorUserId: userId,
        actorKind: "USER",
        action: "workspace_invitation.revoked",
        targetType: "workspace_invitation",
        targetId: invitation.id,
        outcome: "SUCCEEDED",
        requestId
      }
    });
  });
}

export async function acceptInvitation(
  userId: string,
  userEmail: string,
  token: string,
  requestId: string
) {
  const tokenDigest = createHash("sha256").update(token).digest("hex");
  const result = await prisma.$transaction(
    async (transaction) => {
      const invitation = await transaction.workspaceInvitation.findUnique({
        where: { tokenDigest },
        select: {
          id: true,
          workspaceId: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          invitedByUserId: true,
          workspace: { select: workspaceSelect }
        }
      });
      if (!invitation || invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw new WorkspaceDomainError(
          400,
          "invalid_invitation",
          "Invitation not accepted",
          "This invitation is invalid or is assigned to another account."
        );
      }
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${invitation.workspaceId}, 0))`;
      if (invitation.workspace.kind !== "TEAM" || invitation.workspace.status !== "ACTIVE") {
        throw new WorkspaceDomainError(
          409,
          "workspace_unavailable",
          "Workspace unavailable",
          "The invited workspace is not currently available."
        );
      }
      if (invitation.status !== "PENDING") {
        throw new WorkspaceDomainError(
          409,
          "invitation_closed",
          "Invitation already used",
          "This invitation is no longer pending."
        );
      }
      if (invitation.expiresAt <= new Date()) {
        await transaction.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { status: "EXPIRED", closedAt: new Date(), version: { increment: 1 } }
        });
        return { expired: true as const };
      }
      const existing = await transaction.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId }
        },
        select: { role: true }
      });
      const member = existing
        ? await transaction.workspaceMember.findUniqueOrThrow({
            where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
            select: { id: true, role: true, version: true }
          })
        : await transaction.workspaceMember.create({
            data: {
              workspaceId: invitation.workspaceId,
              userId,
              role: invitation.role,
              invitedByUserId: invitation.invitedByUserId
            },
            select: { id: true, role: true, version: true }
          });
      await transaction.workspaceInvitation.update({
        where: { id: invitation.id },
        data: {
          status: "ACCEPTED",
          closedAt: new Date(),
          acceptedAt: new Date(),
          acceptedByUserId: userId,
          version: { increment: 1 }
        }
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: invitation.workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "workspace_invitation.accepted",
          targetType: "workspace_invitation",
          targetId: invitation.id,
          outcome: "SUCCEEDED",
          requestId,
          metadata: { assignedRole: member.role }
        }
      });
      const acceptedBy = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true }
      });
      const activityRecipients = new Set(
        [invitation.workspace.ownerUserId, invitation.invitedByUserId].filter(
          (candidate): candidate is string => Boolean(candidate) && candidate !== userId
        )
      );
      for (const recipientId of activityRecipients) {
        await createNotification(transaction, {
          userId: recipientId,
          workspaceId: invitation.workspaceId,
          type: "NEW_ACTIVITY",
          title: "A new member joined",
          body: `${acceptedBy.name} accepted an invitation to ${invitation.workspace.name}.`,
          actionUrl: `/workspace/${invitation.workspaceId}`,
          data: { memberUserId: userId, role: member.role },
          eventKey: `workspace-invitation:${invitation.id}:accepted:${recipientId}`
        });
      }
      return {
        workspace: workspaceData({ role: member.role, workspace: invitation.workspace }),
        membership: member
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  if ("expired" in result) {
    throw new WorkspaceDomainError(
      410,
      "invitation_expired",
      "Invitation expired",
      "Ask a workspace administrator for a new invitation."
    );
  }
  return result;
}

export async function transferOwnership(
  userId: string,
  workspaceId: string,
  newOwnerUserId: string,
  requestId: string
) {
  return withSerializableRetry(() =>
    prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
        const actor = await activeMembership(userId, workspaceId, transaction);
        if (actor.workspace.kind !== "TEAM") throw wrongKind();
        if (actor.role !== "OWNER" || actor.workspace.ownerUserId !== userId) throw forbidden();
        if (newOwnerUserId === userId) {
          throw new WorkspaceDomainError(
            422,
            "invalid_owner_target",
            "Choose another member",
            "The selected member is already the Owner."
          );
        }
        const target = await transaction.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: newOwnerUserId } },
          select: { id: true, role: true, userId: true }
        });
        if (!target || target.role === "OWNER") throw inaccessible();

        const formerOwner = await transaction.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: "ADMIN", version: { increment: 1 } },
          select: { id: true, userId: true, role: true, version: true }
        });
        const newOwner = await transaction.workspaceMember.update({
          where: { id: target.id },
          data: { role: "OWNER", version: { increment: 1 } },
          select: { id: true, userId: true, role: true, version: true }
        });
        const workspace = await transaction.workspace.update({
          where: { id: workspaceId },
          data: { ownerUserId: newOwnerUserId, version: { increment: 1 } },
          select: workspaceSelect
        });
        await transaction.auditLog.create({
          data: {
            workspaceId,
            actorUserId: userId,
            actorKind: "USER",
            action: "workspace.ownership_transferred",
            targetType: "workspace",
            targetId: workspaceId,
            outcome: "SUCCEEDED",
            requestId,
            changes: { previousOwnerUserId: userId, newOwnerUserId }
          }
        });
        return {
          workspace: workspaceData({ role: formerOwner.role, workspace }),
          formerOwner,
          newOwner
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}
