import "server-only";

import { connect } from "node:net";

import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { getDocumentQueueConnection } from "@/platform/queue/document-queue";
import { getObjectStorage } from "@/platform/storage";

export type DependencyStatus = "ok" | "unavailable" | "skipped";

export interface DependencyCheck {
  readonly status: DependencyStatus;
  readonly durationMs: number;
}

export async function checkDatabase(): Promise<DependencyCheck> {
  return check("database", async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
}

export async function checkRuntimeDependencies() {
  const environment = getServerEnvironment();
  const [database, queue, storage, scanner] = await Promise.all([
    checkDatabase(),
    environment.queue.driver === "direct"
      ? Promise.resolve(skipped())
      : check("queue", async () => {
          await getDocumentQueueConnection().ping();
        }),
    check("storage", async () => {
      await getObjectStorage().checkHealth();
    }),
    environment.documents.scanner === "structural"
      ? Promise.resolve(skipped())
      : check("scanner", () =>
          checkTcpConnection(environment.documents.clamavHost, environment.documents.clamavPort)
        )
  ]);

  return { database, queue, storage, scanner } as const;
}

async function check(_name: string, operation: () => Promise<void>): Promise<DependencyCheck> {
  const startedAt = performance.now();
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("dependency_check_timeout")), 2_000);
        timeout.unref();
      })
    ]);
    return { status: "ok", durationMs: Math.ceil(performance.now() - startedAt) };
  } catch {
    return { status: "unavailable", durationMs: Math.ceil(performance.now() - startedAt) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function skipped(): DependencyCheck {
  return { status: "skipped", durationMs: 0 };
}

function checkTcpConnection(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.once("connect", () => finish());
    socket.once("error", (error) => finish(error));
    socket.setTimeout(1_800, () => finish(new Error("scanner_check_timeout")));
  });
}
