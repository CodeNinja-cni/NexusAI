import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  Prisma,
  type Workflow,
  type WorkflowExecution,
  type WorkspaceRole,
  type WorkflowStatus
} from "@/generated/prisma/client";
import { resolveChatModel } from "@/modules/chat/server/model-catalog";
import { createNotification } from "@/modules/notifications/server/service";
import { releaseAiUsage, reserveAiUsage } from "@/modules/usage/server/quota";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import {
  publishWorkflowExecutionJob,
  type WorkflowExecutionJob
} from "@/platform/queue/workflow-queue";

import {
  WORKFLOW_SCHEMA_VERSION,
  parseWorkflowDefinition,
  workflowDefinitionDigest
} from "./definition";

const RECOVERY_DAYS = 30;
const ACTIVE_EXECUTION_STATUSES = ["QUEUED", "RUNNING", "CANCEL_REQUESTED"] as const;
const WORKFLOW_SELECT = {
  id: true,
  workspaceId: true,
  createdByUserId: true,
  name: true,
  description: true,
  status: true,
  activeVersionId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  purgeAfter: true,
  purgeStartedAt: true,
  version: true
} satisfies Prisma.WorkflowSelect;

export async function listWorkflows(
  userId: string,
  workspaceId: string,
  input: {
    readonly query: string;
    readonly status: WorkflowStatus | "ALL";
    readonly cursor?: string | undefined;
    readonly limit: number;
  }
) {
  const membership = await requireMembership(prisma, userId, workspaceId);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const workflows = await prisma.workflow.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(input.status === "ALL" ? {} : { status: input.status }),
      ...(input.query
        ? {
            OR: [
              { name: { contains: input.query, mode: "insensitive" as const } },
              { description: { contains: input.query, mode: "insensitive" as const } }
            ]
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }
            ]
          }
        : {})
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      ...WORKFLOW_SELECT,
      activeVersion: { select: { versionNumber: true, publishedAt: true } },
      _count: { select: { versions: true, executions: true } }
    }
  });
  const page = workflows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((workflow) => serializeWorkflow(workflow, membership.role)),
    nextCursor:
      workflows.length > input.limit && last
        ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id })
        : null
  };
}

export async function createWorkflow(
  userId: string,
  workspaceId: string,
  input: { readonly name: string; readonly description?: string | undefined },
  requestId: string
) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const membership = await requireMembership(transaction, userId, workspaceId);
      requireAuthor(membership.role);
      const workflow = await transaction.workflow.create({
        data: {
          workspaceId,
          createdByUserId: userId,
          name: input.name,
          description: input.description ?? null
        },
        select: WORKFLOW_SELECT
      });
      await audit(transaction, {
        workspaceId,
        actorUserId: userId,
        action: "workflow.created",
        targetId: workflow.id,
        requestId,
        changes: { name: workflow.name }
      });
      return serializeWorkflow(workflow, membership.role);
    });
  } catch (error) {
    throw translateWorkflowDatabaseError(error);
  }
}

export async function getWorkflow(userId: string, workspaceId: string, workflowId: string) {
  const membership = await requireMembership(prisma, userId, workspaceId);
  const workflow = await prisma.workflow.findUnique({
    where: { id_workspaceId: { id: workflowId, workspaceId }, deletedAt: null },
    select: {
      ...WORKFLOW_SELECT,
      activeVersion: {
        select: {
          id: true,
          versionNumber: true,
          schemaVersion: true,
          publishedAt: true,
          createdAt: true,
          definitionSha256: true
        }
      },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          id: true,
          versionNumber: true,
          schemaVersion: true,
          definition: true,
          publishedAt: true,
          createdAt: true,
          definitionSha256: true
        }
      },
      _count: { select: { versions: true, executions: true } }
    }
  });
  if (!workflow) throw workflowNotFound();
  return serializeWorkflow(workflow, membership.role);
}

export async function updateWorkflow(
  userId: string,
  workspaceId: string,
  workflowId: string,
  input: {
    readonly name?: string | undefined;
    readonly description?: string | null | undefined;
    readonly status?: "DRAFT" | "ARCHIVED" | undefined;
  },
  expectedVersion: number,
  requestId: string
) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const membership = await requireMembership(transaction, userId, workspaceId);
      requireAuthor(membership.role);
      const current = await transaction.workflow.findUnique({
        where: { id_workspaceId: { id: workflowId, workspaceId }, deletedAt: null }
      });
      if (!current) throw workflowNotFound();
      if (current.version !== expectedVersion) throw staleWorkflow();
      if (input.status && !validStatusTransition(current.status, input.status)) {
        throw new WorkspaceDomainError(
          409,
          "workflow_state_invalid",
          "Workflow state cannot change",
          "Only publication can activate a workflow. Drafts can be archived; archived workflows can return to draft."
        );
      }
      const workflow = await transaction.workflow.update({
        where: { id: workflowId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.status === undefined ? {} : { status: input.status }),
          version: { increment: 1 }
        },
        select: WORKFLOW_SELECT
      });
      await audit(transaction, {
        workspaceId,
        actorUserId: userId,
        action: "workflow.updated",
        targetId: workflowId,
        requestId,
        changes: { fields: Object.keys(input), version: workflow.version }
      });
      return serializeWorkflow(workflow, membership.role);
    });
  } catch (error) {
    throw translateWorkflowDatabaseError(error);
  }
}

export async function deleteWorkflow(
  userId: string,
  workspaceId: string,
  workflowId: string,
  expectedVersion: number,
  requestId: string
) {
  return prisma.$transaction(async (transaction) => {
    const membership = await requireMembership(transaction, userId, workspaceId);
    requireAuthor(membership.role);
    const workflow = await transaction.workflow.findUnique({
      where: { id_workspaceId: { id: workflowId, workspaceId }, deletedAt: null }
    });
    if (!workflow) throw workflowNotFound();
    if (workflow.version !== expectedVersion) throw staleWorkflow();
    const running = await transaction.workflowExecution.count({
      where: { workflowId, workspaceId, status: { in: [...ACTIVE_EXECUTION_STATUSES] } }
    });
    if (running > 0) {
      throw new WorkspaceDomainError(
        409,
        "workflow_execution_in_progress",
        "Workflow is currently running",
        "Cancel or wait for active executions before deleting this workflow."
      );
    }
    const now = new Date();
    const updated = await transaction.workflow.update({
      where: { id: workflowId },
      data: {
        status: "ARCHIVED",
        deletedAt: now,
        purgeAfter: new Date(now.getTime() + RECOVERY_DAYS * 24 * 60 * 60 * 1_000),
        version: { increment: 1 }
      },
      select: WORKFLOW_SELECT
    });
    await audit(transaction, {
      workspaceId,
      actorUserId: userId,
      action: "workflow.deleted",
      targetId: workflowId,
      requestId,
      changes: { purgeAfter: updated.purgeAfter?.toISOString() }
    });
    return { id: workflowId, deletedAt: updated.deletedAt, purgeAfter: updated.purgeAfter };
  });
}

export async function restoreWorkflow(
  userId: string,
  workspaceId: string,
  workflowId: string,
  requestId: string
) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const membership = await requireMembership(transaction, userId, workspaceId);
      requireAuthor(membership.role);
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workflowId}, 0))`;
      const workflow = await transaction.workflow.findUnique({
        where: { id_workspaceId: { id: workflowId, workspaceId } }
      });
      if (!workflow?.deletedAt) throw workflowNotFound();
      if (!workflow.purgeAfter || workflow.purgeAfter <= new Date() || workflow.purgeStartedAt) {
        throw new WorkspaceDomainError(
          409,
          "restoration_unavailable",
          "Workflow cannot be restored",
          "The recovery window has ended or permanent cleanup has started."
        );
      }
      const restored = await transaction.workflow.update({
        where: { id: workflowId },
        data: {
          status: "DRAFT",
          activeVersionId: null,
          deletedAt: null,
          purgeAfter: null,
          purgeStartedAt: null,
          version: { increment: 1 }
        },
        select: WORKFLOW_SELECT
      });
      await audit(transaction, {
        workspaceId,
        actorUserId: userId,
        action: "workflow.restored",
        targetId: workflowId,
        requestId,
        changes: { status: "DRAFT" }
      });
      return serializeWorkflow(restored, membership.role);
    });
  } catch (error) {
    throw translateWorkflowDatabaseError(error);
  }
}

export async function listWorkflowVersions(
  userId: string,
  workspaceId: string,
  workflowId: string
) {
  await requireWorkflowReader(userId, workspaceId, workflowId);
  const versions = await prisma.workflowVersion.findMany({
    where: { workspaceId, workflowId },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      schemaVersion: true,
      publishedAt: true,
      createdAt: true,
      definitionSha256: true
    }
  });
  return versions.map(serializeVersion);
}

export async function createWorkflowVersion(
  userId: string,
  workspaceId: string,
  workflowId: string,
  value: unknown,
  requestId: string
) {
  const environment = getServerEnvironment();
  const definition = parseWorkflowDefinition(value, {
    maxNodes: environment.workflows.maxNodes,
    maxSteps: environment.workflows.maxSteps
  });
  const digest = workflowDefinitionDigest(definition);
  return prisma.$transaction(
    async (transaction) => {
      const membership = await requireMembership(transaction, userId, workspaceId);
      requireAuthor(membership.role);
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workflowId}, 0))`;
      const workflow = await transaction.workflow.findUnique({
        where: { id_workspaceId: { id: workflowId, workspaceId }, deletedAt: null }
      });
      if (!workflow) throw workflowNotFound();
      const latest = await transaction.workflowVersion.aggregate({
        where: { workflowId, workspaceId },
        _max: { versionNumber: true }
      });
      const version = await transaction.workflowVersion.create({
        data: {
          workspaceId,
          workflowId,
          versionNumber: (latest._max.versionNumber ?? 0) + 1,
          schemaVersion: WORKFLOW_SCHEMA_VERSION,
          definition: toInputJson(definition),
          createdByUserId: userId,
          definitionSha256: digest
        }
      });
      await transaction.workflow.update({
        where: { id: workflowId },
        data: { version: { increment: 1 } }
      });
      await audit(transaction, {
        workspaceId,
        actorUserId: userId,
        action: "workflow.version_created",
        targetId: workflowId,
        requestId,
        changes: { versionId: version.id, versionNumber: version.versionNumber, digest }
      });
      return { ...serializeVersion(version), definition };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function getWorkflowVersion(
  userId: string,
  workspaceId: string,
  workflowId: string,
  versionId: string
) {
  await requireWorkflowReader(userId, workspaceId, workflowId);
  const version = await prisma.workflowVersion.findUnique({
    where: { id_workflowId_workspaceId: { id: versionId, workflowId, workspaceId } }
  });
  if (!version) throw workflowNotFound();
  return { ...serializeVersion(version), definition: version.definition };
}

export async function publishWorkflowVersion(
  userId: string,
  workspaceId: string,
  workflowId: string,
  versionId: string,
  requestId: string
) {
  const environment = getServerEnvironment();
  return prisma.$transaction(
    async (transaction) => {
      const membership = await requireMembership(transaction, userId, workspaceId);
      requireAuthor(membership.role);
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workflowId}, 0))`;
      const workflow = await transaction.workflow.findUnique({
        where: { id_workspaceId: { id: workflowId, workspaceId }, deletedAt: null }
      });
      if (!workflow) throw workflowNotFound();
      const version = await transaction.workflowVersion.findUnique({
        where: { id_workflowId_workspaceId: { id: versionId, workflowId, workspaceId } }
      });
      if (!version) throw workflowNotFound();
      const definition = parseWorkflowDefinition(version.definition, {
        maxNodes: environment.workflows.maxNodes,
        maxSteps: environment.workflows.maxSteps
      });
      for (const node of definition.nodes) {
        if (node.kind === "AI_PROMPT") resolveChatModel(node.config.modelKey);
      }
      const now = new Date();
      await transaction.workflowVersion.updateMany({
        where: { id: versionId, publishedAt: null },
        data: { publishedAt: now }
      });
      const updated = await transaction.workflow.update({
        where: { id: workflowId },
        data: { status: "ACTIVE", activeVersionId: versionId, version: { increment: 1 } },
        select: WORKFLOW_SELECT
      });
      await audit(transaction, {
        workspaceId,
        actorUserId: userId,
        action: "workflow.published",
        targetId: workflowId,
        requestId,
        changes: { versionId, versionNumber: version.versionNumber }
      });
      return serializeWorkflow(updated, membership.role);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function listWorkflowExecutions(
  userId: string,
  workspaceId: string,
  workflowId: string,
  input: { readonly cursor?: string | undefined; readonly limit: number }
) {
  await requireWorkflowReader(userId, workspaceId, workflowId);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const executions = await prisma.workflowExecution.findMany({
    where: {
      workspaceId,
      workflowId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.updatedAt } },
              { createdAt: cursor.updatedAt, id: { lt: cursor.id } }
            ]
          }
        : {})
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1
  });
  const page = executions.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((execution) => serializeExecution(execution, userId)),
    nextCursor:
      executions.length > input.limit && last
        ? encodeCursor({ updatedAt: last.createdAt.toISOString(), id: last.id })
        : null
  };
}

export async function startWorkflowExecution(
  userId: string,
  workspaceId: string,
  workflowId: string,
  input: { readonly text: string },
  idempotencyKey: string,
  requestId: string
) {
  const environment = getServerEnvironment();
  if ([...input.text].length > environment.workflows.maxInputCharacters) {
    throw new WorkspaceDomainError(
      422,
      "workflow_input_too_large",
      "Workflow input is too large",
      `Workflow input is limited to ${environment.workflows.maxInputCharacters} characters.`
    );
  }
  const inputJson = { text: input.text };
  const inputSha256 = digestJson(inputJson);
  const idempotencyKeyHash = createHash("sha256")
    .update(`${workspaceId}\u0000${userId}\u0000${idempotencyKey}`)
    .digest("hex");
  const result = await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
      const membership = await requireMembership(transaction, userId, workspaceId);
      const replay = await transaction.workflowExecution.findUnique({
        where: { idempotencyKeyHash }
      });
      if (replay) {
        if (
          replay.workspaceId !== workspaceId ||
          replay.workflowId !== workflowId ||
          replay.requestedByUserId !== userId ||
          replay.inputSha256 !== inputSha256
        ) {
          throw new WorkspaceDomainError(
            409,
            "idempotency_conflict",
            "Idempotency key conflict",
            "Use a new Idempotency-Key for different workflow input."
          );
        }
        return { execution: replay, replay: true as const };
      }
      const workflow = await transaction.workflow.findUnique({
        where: { id_workspaceId: { id: workflowId, workspaceId }, deletedAt: null },
        include: { activeVersion: true }
      });
      if (!workflow || workflow.status !== "ACTIVE" || !workflow.activeVersion) {
        throw new WorkspaceDomainError(
          409,
          "workflow_not_published",
          "Workflow is not published",
          "Publish a validated workflow version before starting an execution."
        );
      }
      const recentStarts = await transaction.workflowExecution.count({
        where: {
          workspaceId,
          requestedByUserId: userId,
          createdAt: { gte: new Date(Date.now() - 60_000) }
        }
      });
      if (recentStarts >= 10) {
        throw new WorkspaceDomainError(
          429,
          "rate_limited",
          "Workflow start limit reached",
          "Wait before starting another workflow.",
          { "Retry-After": "60" }
        );
      }
      const activeCount = await transaction.workflowExecution.count({
        where: { workspaceId, status: { in: [...ACTIVE_EXECUTION_STATUSES] } }
      });
      if (activeCount >= environment.workflows.concurrentPerWorkspace) {
        throw new WorkspaceDomainError(
          429,
          "concurrency_limit",
          "Workflow concurrency limit reached",
          "Wait for an active workflow to finish before starting another.",
          { "Retry-After": "5" }
        );
      }
      const definition = parseWorkflowDefinition(workflow.activeVersion.definition, {
        maxNodes: environment.workflows.maxNodes,
        maxSteps: environment.workflows.maxSteps
      });
      const executionId = randomUUID();
      for (const node of definition.nodes) {
        if (node.kind !== "AI_PROMPT") continue;
        const model = resolveChatModel(node.config.modelKey);
        await reserveAiUsage(transaction, {
          workspaceId,
          userId,
          logicalOperationId: workflowNodeOperationId(executionId, node.id),
          prompt: [
            {
              role: "user",
              content: `${node.config.instruction}\n\nInput:\n${input.text}`.slice(
                0,
                environment.workflows.maxInputCharacters + 4_000
              )
            }
          ],
          provider: model.provider,
          model:
            model.provider === "openai" ? environment.ai.openAiModel : "nexus-deterministic-v1",
          reservationDurationMs: environment.workflows.timeoutMs
        });
      }
      const execution = await transaction.workflowExecution.create({
        data: {
          id: executionId,
          workspaceId,
          workflowId,
          workflowVersionId: workflow.activeVersion.id,
          requestedByUserId: userId,
          input: inputJson,
          inputSha256,
          idempotencyKeyHash,
          stepLimit: environment.workflows.maxSteps,
          timeoutMs: environment.workflows.timeoutMs,
          outputCharacterLimit: environment.workflows.maxOutputCharacters
        }
      });
      await transaction.workflowExecutionLog.create({
        data: {
          workspaceId,
          executionId,
          sequence: 1n,
          event: "execution.queued",
          message: "Execution accepted and queued.",
          data: {
            workflowVersionId: workflow.activeVersion.id,
            versionNumber: workflow.activeVersion.versionNumber,
            stepLimit: execution.stepLimit,
            timeoutMs: execution.timeoutMs
          }
        }
      });
      await transaction.outboxEvent.create({
        data: {
          deduplicationKey: digestText(`workflow-execution:${executionId}`),
          topic: "workflow.execution.requested",
          aggregateType: "WorkflowExecution",
          aggregateId: executionId,
          workspaceId,
          payload: { workspaceId, workflowId, executionId }
        }
      });
      await audit(transaction, {
        workspaceId,
        actorUserId: userId,
        action: "workflow.execution_started",
        targetId: executionId,
        requestId,
        changes: {
          workflowId,
          workflowVersionId: workflow.activeVersion.id,
          role: membership.role
        }
      });
      return { execution, replay: false as const };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  if (!result.replay) await dispatchExecution(result.execution);
  return serializeExecution(result.execution, userId);
}

export async function getWorkflowExecution(
  userId: string,
  workspaceId: string,
  executionId: string
) {
  const membership = await requireMembership(prisma, userId, workspaceId);
  const execution = await prisma.workflowExecution.findUnique({
    where: { id_workspaceId: { id: executionId, workspaceId } },
    include: {
      workflow: { select: { name: true } },
      workflowVersion: { select: { versionNumber: true, definitionSha256: true } },
      _count: { select: { logs: true, usageRecords: true } }
    }
  });
  if (!execution) throw workflowNotFound();
  return {
    ...serializeExecution(execution, userId, membership.role),
    workflow: execution.workflow,
    workflowVersion: execution.workflowVersion,
    logCount: execution._count.logs,
    usageRecordCount: execution._count.usageRecords
  };
}

export async function listWorkflowExecutionLogs(
  userId: string,
  workspaceId: string,
  executionId: string,
  input: { readonly after: bigint; readonly limit: number }
) {
  await requireMembership(prisma, userId, workspaceId);
  const execution = await prisma.workflowExecution.findUnique({
    where: { id_workspaceId: { id: executionId, workspaceId } },
    select: { id: true }
  });
  if (!execution) throw workflowNotFound();
  const logs = await prisma.workflowExecutionLog.findMany({
    where: { workspaceId, executionId, sequence: { gt: input.after } },
    orderBy: { sequence: "asc" },
    take: input.limit
  });
  return logs.map((log) => ({
    ...log,
    sequence: log.sequence.toString(),
    createdAt: log.createdAt.toISOString()
  }));
}

export async function cancelWorkflowExecution(
  userId: string,
  workspaceId: string,
  executionId: string,
  requestId: string
) {
  return prisma.$transaction(async (transaction) => {
    const membership = await requireMembership(transaction, userId, workspaceId);
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${executionId}, 0))`;
    const execution = await transaction.workflowExecution.findUnique({
      where: { id_workspaceId: { id: executionId, workspaceId } }
    });
    if (!execution) throw workflowNotFound();
    if (execution.requestedByUserId !== userId && membership.role === "MEMBER") {
      throw workflowNotFound();
    }
    if (["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(execution.status)) {
      return serializeExecution(execution, userId, membership.role);
    }
    const now = new Date();
    const status = execution.status === "QUEUED" ? "CANCELLED" : "CANCEL_REQUESTED";
    if (status === "CANCELLED") {
      const version = await transaction.workflowVersion.findUnique({
        where: { id: execution.workflowVersionId },
        select: { definition: true }
      });
      if (version) {
        const environment = getServerEnvironment();
        const definition = parseWorkflowDefinition(version.definition, {
          maxNodes: environment.workflows.maxNodes,
          maxSteps: environment.workflows.maxSteps
        });
        for (const node of definition.nodes) {
          if (node.kind === "AI_PROMPT") {
            await releaseAiUsage(transaction, workflowNodeOperationId(execution.id, node.id));
          }
        }
      }
    }
    const updated = await transaction.workflowExecution.update({
      where: { id: executionId },
      data: {
        status,
        cancelRequestedAt: now,
        ...(status === "CANCELLED" ? { finishedAt: now } : {}),
        version: { increment: 1 }
      }
    });
    const sequence = await nextLogSequence(transaction, executionId);
    await transaction.workflowExecutionLog.create({
      data: {
        workspaceId,
        executionId,
        sequence,
        event: status === "CANCELLED" ? "execution.cancelled" : "execution.cancel_requested",
        message:
          status === "CANCELLED"
            ? "Queued execution was cancelled."
            : "Cancellation was requested.",
        data: { requestedByRole: membership.role }
      }
    });
    await audit(transaction, {
      workspaceId,
      actorUserId: userId,
      action: "workflow.execution_cancelled",
      targetId: executionId,
      requestId,
      changes: { status }
    });
    return serializeExecution(updated, userId, membership.role);
  });
}

export const workflowEtag = (id: string, version: number) => `"workflow:${id}:${version}"`;

async function dispatchExecution(execution: {
  id: string;
  workspaceId: string;
  workflowId: string;
}) {
  const job: WorkflowExecutionJob = {
    workspaceId: execution.workspaceId,
    workflowId: execution.workflowId,
    executionId: execution.id
  };
  try {
    await publishWorkflowExecutionJob(job);
    await prisma.$transaction([
      prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { queueJobId: execution.id }
      }),
      prisma.outboxEvent.updateMany({
        where: {
          deduplicationKey: digestText(`workflow-execution:${execution.id}`),
          status: { not: "PUBLISHED" }
        },
        data: {
          status: "PUBLISHED",
          attempts: { increment: 1 },
          publishedAt: new Date(),
          lastErrorRedacted: null
        }
      })
    ]);
    if (getServerEnvironment().queue.driver === "direct") {
      setTimeout(() => {
        void import("./worker")
          .then(({ processWorkflowExecution }) => processWorkflowExecution(job))
          .catch((error: unknown) =>
            console.error("Direct workflow execution failed", {
              executionId: execution.id,
              errorName: error instanceof Error ? error.name : "UnknownError"
            })
          );
      }, 0);
    }
  } catch {
    // The durable outbox remains available for a dispatcher retry.
  }
}

type VersionRecord = {
  readonly id?: string;
  readonly versionNumber: number;
  readonly schemaVersion?: string;
  readonly publishedAt: Date | null;
  readonly createdAt?: Date;
  readonly definitionSha256?: string;
  readonly definition?: Prisma.JsonValue;
};

function serializeWorkflow<T extends Workflow>(
  workflow: T & {
    readonly activeVersion?: VersionRecord | null;
    readonly versions?: readonly VersionRecord[];
    readonly _count?: { readonly versions?: number; readonly executions?: number };
  },
  role: WorkspaceRole
) {
  const {
    createdAt,
    updatedAt,
    deletedAt,
    purgeAfter,
    purgeStartedAt,
    activeVersion,
    versions,
    _count: counts,
    ...record
  } = workflow;
  return {
    ...record,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    deletedAt: deletedAt?.toISOString() ?? null,
    purgeAfter: purgeAfter?.toISOString() ?? null,
    purgeStartedAt: purgeStartedAt?.toISOString() ?? null,
    ...(activeVersion ? { activeVersion: serializeVersion(activeVersion) } : {}),
    ...(versions ? { latestVersion: versions[0] ? serializeVersion(versions[0]) : null } : {}),
    ...(counts
      ? { versionCount: counts.versions ?? 0, executionCount: counts.executions ?? 0 }
      : {}),
    capabilities: {
      view: true,
      execute: true,
      edit: role === "OWNER" || role === "ADMIN",
      publish: role === "OWNER" || role === "ADMIN",
      delete: role === "OWNER" || role === "ADMIN"
    },
    etag: workflowEtag(workflow.id, workflow.version)
  };
}

function serializeVersion<T extends VersionRecord>(version: T) {
  const { publishedAt, createdAt, ...record } = version;
  return {
    ...record,
    publishedAt: publishedAt?.toISOString() ?? null,
    ...(createdAt ? { createdAt: createdAt.toISOString() } : {})
  };
}

function serializeExecution<T extends WorkflowExecution>(
  execution: T,
  userId: string,
  role: WorkspaceRole = "MEMBER"
) {
  const {
    createdAt,
    updatedAt,
    startedAt,
    finishedAt,
    cancelRequestedAt,
    output,
    input,
    ...record
  } = execution;
  const status = String(execution.status);
  return {
    ...record,
    input,
    output: safeTextPayload(output),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    startedAt: startedAt?.toISOString() ?? null,
    finishedAt: finishedAt?.toISOString() ?? null,
    cancelRequestedAt: cancelRequestedAt?.toISOString() ?? null,
    capabilities: {
      cancel:
        ACTIVE_EXECUTION_STATUSES.includes(status as (typeof ACTIVE_EXECUTION_STATUSES)[number]) &&
        (execution.requestedByUserId === userId || role === "OWNER" || role === "ADMIN")
    }
  };
}

function safeTextPayload(value: Prisma.JsonValue | null) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const text = (value as Record<string, Prisma.JsonValue>).text;
  return typeof text === "string" ? { text } : null;
}

async function requireWorkflowReader(userId: string, workspaceId: string, workflowId: string) {
  const membership = await requireMembership(prisma, userId, workspaceId);
  const workflow = await prisma.workflow.findUnique({
    where: { id_workspaceId: { id: workflowId, workspaceId }, deletedAt: null },
    select: { id: true }
  });
  if (!workflow) throw workflowNotFound();
  return membership;
}

async function requireMembership(
  transaction: Prisma.TransactionClient | typeof prisma,
  userId: string,
  workspaceId: string
) {
  const membership = await transaction.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
      workspace: { status: "ACTIVE", deletedAt: null }
    },
    select: { role: true }
  });
  if (!membership) throw workflowNotFound();
  return membership;
}

function requireAuthor(role: WorkspaceRole) {
  if (role === "MEMBER") {
    throw new WorkspaceDomainError(
      403,
      "forbidden",
      "Workflow authoring is not permitted",
      "Only workspace Owners and Admins can configure workflows."
    );
  }
}

function validStatusTransition(current: WorkflowStatus, next: "DRAFT" | "ARCHIVED") {
  return (
    (current === "DRAFT" && next === "ARCHIVED") ||
    (current === "ARCHIVED" && next === "DRAFT") ||
    (current === "ACTIVE" && next === "ARCHIVED")
  );
}

function workflowNotFound() {
  return new WorkspaceDomainError(
    404,
    "not_found",
    "Workflow not found",
    "The requested workflow resource is not available."
  );
}

function staleWorkflow() {
  return new WorkspaceDomainError(
    412,
    "stale_version",
    "Workflow changed",
    "Reload this workflow before applying the change."
  );
}

function translateWorkflowDatabaseError(error: unknown): unknown {
  if (error instanceof WorkspaceDomainError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new WorkspaceDomainError(
      409,
      "workflow_name_conflict",
      "Workflow name already exists",
      "Choose a different workflow name in this workspace."
    );
  }
  return error;
}

async function audit(
  transaction: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    readonly actorUserId: string;
    readonly action: string;
    readonly targetId: string;
    readonly requestId: string;
    readonly changes: Prisma.InputJsonValue;
  }
) {
  await transaction.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      actorKind: "USER",
      action: input.action,
      targetType: "Workflow",
      targetId: input.targetId,
      outcome: "SUCCEEDED",
      requestId: input.requestId,
      changes: input.changes
    }
  });
}

export async function createWorkflowStatusNotification(
  transaction: Prisma.TransactionClient,
  input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly workflowId: string;
    readonly executionId: string;
    readonly workflowName: string;
    readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  }
) {
  const humanStatus = input.status.slice(0, 1) + input.status.slice(1).toLowerCase();
  await createNotification(transaction, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    type: "WORKFLOW_STATUS",
    title: `Workflow ${humanStatus.toLowerCase()}`,
    body: `${input.workflowName} finished with status ${humanStatus}.`,
    actionUrl: `/workflows/${input.workflowId}?execution=${input.executionId}`,
    data: { workflowId: input.workflowId, executionId: input.executionId, status: input.status },
    eventKey: `workflow:${input.executionId}:${input.status.toLowerCase()}`
  });
}

export async function nextLogSequence(transaction: Prisma.TransactionClient, executionId: string) {
  const latest = await transaction.workflowExecutionLog.aggregate({
    where: { executionId },
    _max: { sequence: true }
  });
  return (latest._max.sequence ?? 0n) + 1n;
}

export function workflowNodeOperationId(executionId: string, nodeId: string) {
  const digest = createHash("sha256").update(`${executionId}\u0000${nodeId}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function digestText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function digestJson(value: unknown) {
  return digestText(JSON.stringify(value));
}

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function encodeCursor(value: { readonly updatedAt: string; readonly id: string }) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string) {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof decoded.updatedAt !== "string" || typeof decoded.id !== "string") throw new Error();
    const updatedAt = new Date(decoded.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) throw new Error();
    return { updatedAt, id: decoded.id };
  } catch {
    throw new WorkspaceDomainError(
      400,
      "invalid_cursor",
      "Cursor is invalid",
      "Restart pagination without the supplied cursor."
    );
  }
}
