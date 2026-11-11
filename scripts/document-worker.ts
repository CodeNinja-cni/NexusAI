import { Worker } from "bullmq";

import { processDocumentJob } from "@/modules/documents/server/worker";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { logger } from "@/platform/observability/logger";
import { reportOperationalError } from "@/platform/observability/error-reporting";
import {
  documentQueueName,
  getDocumentQueueConnection,
  type DocumentProcessingJob
} from "@/platform/queue/document-queue";

if (getServerEnvironment().queue.driver !== "bullmq") {
  throw new Error("The document worker requires QUEUE_DRIVER=bullmq.");
}

const worker = new Worker<DocumentProcessingJob>(
  documentQueueName(),
  async (job) =>
    processDocumentJob(job.data, {
      finalAttempt: job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1)
    }),
  {
    connection: getDocumentQueueConnection(),
    concurrency: getServerEnvironment().queue.concurrency
  }
);

worker.on("failed", (job, error) => {
  void reportOperationalError(error, {
    component: "document-worker",
    operation: "process-document",
    ...(job?.id ? { referenceId: job.id } : {})
  });
});

const shutdown = async () => {
  await worker.close();
  await getDocumentQueueConnection().quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

logger.info("document_worker.started", { queue: documentQueueName() });
