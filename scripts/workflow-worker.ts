import { Worker } from "bullmq";

import { processWorkflowExecution } from "@/modules/workflows/server/worker";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { logger } from "@/platform/observability/logger";
import { reportOperationalError } from "@/platform/observability/error-reporting";
import {
  getWorkflowQueueConnection,
  workflowQueueName,
  type WorkflowExecutionJob
} from "@/platform/queue/workflow-queue";

if (getServerEnvironment().queue.driver !== "bullmq") {
  throw new Error("The workflow worker requires QUEUE_DRIVER=bullmq.");
}

const worker = new Worker<WorkflowExecutionJob>(
  workflowQueueName(),
  async (job) => processWorkflowExecution(job.data),
  {
    connection: getWorkflowQueueConnection(),
    concurrency: getServerEnvironment().queue.concurrency
  }
);

worker.on("failed", (job, error) => {
  void reportOperationalError(error, {
    component: "workflow-worker",
    operation: "execute-workflow",
    ...(job?.id ? { referenceId: job.id } : {})
  });
});

const shutdown = async () => {
  await worker.close();
  await getWorkflowQueueConnection().quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

logger.info("workflow_worker.started", { queue: workflowQueueName() });
