import "server-only";

import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

import { getServerEnvironment } from "@/platform/env/server";

export interface DocumentProcessingJob {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly runId: string;
}

let connection: IORedis | undefined;
let queue: Queue<DocumentProcessingJob> | undefined;

export function documentQueueName() {
  return `${getServerEnvironment().queue.namespace}:documents`;
}

export function getDocumentQueueConnection() {
  connection ??= new IORedis(getServerEnvironment().queue.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
  return connection;
}

export function getDocumentQueue() {
  queue ??= new Queue<DocumentProcessingJob>(documentQueueName(), {
    connection: getDocumentQueueConnection(),
    defaultJobOptions: processingJobOptions()
  });
  return queue;
}

export async function publishDocumentProcessingJob(job: DocumentProcessingJob) {
  if (getServerEnvironment().queue.driver === "direct") return job.runId;
  await getDocumentQueue().add("process", job, {
    ...processingJobOptions(),
    jobId: job.runId
  });
  return job.runId;
}

function processingJobOptions(): JobsOptions {
  return {
    attempts: 5,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 2_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 }
  };
}
