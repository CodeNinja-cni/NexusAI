import "server-only";

import { getServerEnvironment } from "@/platform/env/server";

import { logger } from "./logger";

export interface ServerErrorContext {
  readonly routePath: string;
  readonly routeType: string;
  readonly routerKind: string;
  readonly method: string;
}

export async function reportServerError(error: unknown, context: ServerErrorContext) {
  return deliverError(error, {
    kind: "request",
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    method: context.method
  });
}

export async function reportOperationalError(
  error: unknown,
  context: {
    readonly component: string;
    readonly operation: string;
    readonly referenceId?: string;
  }
) {
  return deliverError(error, { kind: "operation", ...context });
}

async function deliverError(error: unknown, context: Readonly<Record<string, unknown>>) {
  const environment = getServerEnvironment();
  const errorName = error instanceof Error ? error.name : "NonErrorThrown";
  const digest = readDigest(error);
  const safeContext = {
    ...context,
    errorName,
    ...(digest ? { digest } : {})
  };

  logger.error("server.request.error", safeContext);

  const endpoint = environment.observability.errorReportingEndpoint;
  const token = environment.observability.errorReportingToken;
  if (!endpoint || !token) return;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": `${environment.observability.serviceName}/${environment.observability.releaseVersion}`
      },
      body: JSON.stringify({
        occurredAt: new Date().toISOString(),
        service: environment.observability.serviceName,
        release: environment.observability.releaseVersion,
        environment: environment.appEnvironment,
        error: { name: errorName, ...(digest ? { digest } : {}) },
        context: safeContext
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(environment.observability.errorReportingTimeoutMs)
    });

    if (!response.ok) {
      logger.warn("error_report.delivery_failed", { status: response.status });
    }
  } catch (deliveryError) {
    logger.warn("error_report.delivery_failed", {
      errorName: deliveryError instanceof Error ? deliveryError.name : "NonErrorThrown"
    });
  }
}

function readDigest(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("digest" in error)) return undefined;
  const digest = error.digest;
  return typeof digest === "string" && digest.length <= 128 ? digest : undefined;
}
