import { provisionPersonalWorkspace } from "@/modules/workspaces/server/provision-personal-workspace";
import { expireStaleWorkflowExecutions } from "@/modules/workflows/server/worker";
import { prisma } from "@/platform/database/prisma";
import { dispatchPendingAuthEmails } from "@/platform/mail/auth-email";
import { logger } from "@/platform/observability/logger";
import { publishDocumentProcessingJob } from "@/platform/queue/document-queue";
import { publishWorkflowExecutionJob } from "@/platform/queue/workflow-queue";

try {
  const emailCount = await dispatchPendingAuthEmails();
  const expiredWorkflowCount = await expireStaleWorkflowExecutions();
  const provisioningEvents = await prisma.outboxEvent.findMany({
    where: {
      topic: "user.provision.requested",
      status: { in: ["PENDING", "FAILED"] },
      availableAt: { lte: new Date() },
      attempts: { lt: 10 }
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { aggregateId: true }
  });

  for (const event of provisioningEvents) {
    await provisionPersonalWorkspace(event.aggregateId);
  }

  const documentEvents = await prisma.outboxEvent.findMany({
    where: {
      topic: "document.processing.requested",
      status: { in: ["PENDING", "FAILED"] },
      availableAt: { lte: new Date() },
      attempts: { lt: 10 }
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, payload: true }
  });
  let documentCount = 0;
  for (const event of documentEvents) {
    const payload = documentPayload(event.payload);
    try {
      await publishDocumentProcessingJob(payload);
      await prisma.$transaction([
        prisma.documentProcessingRun.updateMany({
          where: { id: payload.runId },
          data: { queueJobId: payload.runId }
        }),
        prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: "PUBLISHED",
            attempts: { increment: 1 },
            publishedAt: new Date(),
            lastErrorRedacted: null
          }
        })
      ]);
      documentCount += 1;
    } catch {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          availableAt: new Date(Date.now() + 60_000),
          lastErrorRedacted: "document_queue_publish_failed"
        }
      });
    }
  }

  const workflowEvents = await prisma.outboxEvent.findMany({
    where: {
      topic: "workflow.execution.requested",
      status: { in: ["PENDING", "FAILED"] },
      availableAt: { lte: new Date() },
      attempts: { lt: 10 }
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, payload: true }
  });
  let workflowCount = 0;
  for (const event of workflowEvents) {
    const payload = workflowPayload(event.payload);
    try {
      await publishWorkflowExecutionJob(payload);
      await prisma.$transaction([
        prisma.workflowExecution.updateMany({
          where: { id: payload.executionId },
          data: { queueJobId: payload.executionId }
        }),
        prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: "PUBLISHED",
            attempts: { increment: 1 },
            publishedAt: new Date(),
            lastErrorRedacted: null
          }
        })
      ]);
      workflowCount += 1;
    } catch {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          availableAt: new Date(Date.now() + 60_000),
          lastErrorRedacted: "workflow_queue_publish_failed"
        }
      });
    }
  }

  logger.info("outbox_dispatch.completed", {
    emailCount,
    provisioningCount: provisioningEvents.length,
    documentCount,
    workflowCount,
    expiredWorkflowCount
  });
} finally {
  await prisma.$disconnect();
}

function documentPayload(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("invalid_document_event");
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.workspaceId !== "string" ||
    typeof payload.documentId !== "string" ||
    typeof payload.runId !== "string"
  ) {
    throw new Error("invalid_document_event");
  }
  return {
    workspaceId: payload.workspaceId,
    documentId: payload.documentId,
    runId: payload.runId
  };
}

function workflowPayload(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("invalid_workflow_event");
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.workspaceId !== "string" ||
    typeof payload.workflowId !== "string" ||
    typeof payload.executionId !== "string"
  ) {
    throw new Error("invalid_workflow_event");
  }
  return {
    workspaceId: payload.workspaceId,
    workflowId: payload.workflowId,
    executionId: payload.executionId
  };
}
