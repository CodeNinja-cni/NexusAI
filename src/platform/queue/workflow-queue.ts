import "server-only";

import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

import { getServerEnvironment } from "@/platform/env/server";

export interface WorkflowExecutionJob {
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly executionId: string;
}

let connection: IORedis | undefined;
let queue: Queue<WorkflowExecutionJob> | undefined;

export function workflowQueueName() {
  return `${getServerEnvironment().queue.namespace}:workflows`;
}

export function getWorkflowQueueConnection() {
  connection ??= new IORedis(getServerEnvironment().queue.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
  return connection;
}

export function getWorkflowQueue() {
  queue ??= new Queue<WorkflowExecutionJob>(workflowQueueName(), {
    connection: getWorkflowQueueConnection(),
    defaultJobOptions: workflowJobOptions()
  });
  return queue;
}

export async function publishWorkflowExecutionJob(job: WorkflowExecutionJob) {
  if (getServerEnvironment().queue.driver === "direct") return job.executionId;
  await getWorkflowQueue().add("execute", job, {
    ...workflowJobOptions(),
    jobId: job.executionId
  });
  return job.executionId;
}

function workflowJobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: { age: 24 * 60 * 60, count: 2_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 }
  };
}
