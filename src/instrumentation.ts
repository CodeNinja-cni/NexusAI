import type { Instrumentation } from "next";

import { getServerEnvironment } from "@/platform/env/server";
import { reportServerError } from "@/platform/observability/error-reporting";
import { logger } from "@/platform/observability/logger";

export function register() {
  const environment = getServerEnvironment();
  logger.info("service.started", {
    runtime: process.env.NEXT_RUNTIME ?? "nodejs",
    baseOrigin: new URL(environment.appBaseUrl).origin
  });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await reportServerError(error, {
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    method: request.method
  });
};
