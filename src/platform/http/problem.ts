import "server-only";

import type { ZodError } from "zod";

import { logger } from "@/platform/observability/logger";

interface ProblemOptions {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly headers?: HeadersInit;
  readonly errors?: readonly {
    readonly path: string;
    readonly code: string;
    readonly message: string;
  }[];
}

export function problemResponse(options: ProblemOptions): Response {
  return Response.json(
    {
      type: `https://nexus.local/problems/${options.code.replaceAll("_", "-")}`,
      title: options.title,
      status: options.status,
      detail: options.detail,
      instance: options.instance,
      code: options.code,
      requestId: options.requestId,
      ...(options.errors ? { errors: options.errors } : {})
    },
    {
      status: options.status,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/problem+json",
        "X-Request-Id": options.requestId,
        ...options.headers
      }
    }
  );
}

export function validationProblem(error: ZodError, instance: string, requestId: string): Response {
  return problemResponse({
    status: 422,
    code: "validation_error",
    title: "Request validation failed",
    detail: "One or more fields are invalid.",
    instance,
    requestId,
    errors: error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message
    }))
  });
}

export function internalProblemResponse(
  instance: string,
  requestId: string,
  scope = "api"
): Response {
  // Keep the correlation identifier, but never serialize the thrown value. Provider errors,
  // database diagnostics, signed URLs, and request content can all contain secrets.
  logger.error("api.request.failed", { scope, requestId });
  return problemResponse({
    status: 500,
    code: "internal_error",
    title: "Request failed",
    detail: "The request could not be completed safely.",
    instance,
    requestId
  });
}
