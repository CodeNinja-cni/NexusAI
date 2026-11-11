import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  WorkspaceDomainError,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { problemResponse } from "@/platform/http/problem";

import { ChatRateLimitError } from "./rate-limit";
import { ProviderConfigurationError, UnsupportedChatModelError } from "./model-catalog";

export function requireIdempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (
    !key ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)
  ) {
    throw new WorkspaceDomainError(
      400,
      "invalid_idempotency_key",
      "Invalid idempotency key",
      "Provide a UUID v4 Idempotency-Key header."
    );
  }
  return key;
}

export const conversationEtag = (id: string, version: number) => `"conversation:${id}:${version}"`;

export function chatErrorResponse(error: unknown, instance: string, requestId: string): Response {
  if (error instanceof UnsupportedChatModelError) {
    return problemResponse({
      status: 422,
      code: "unsupported_model",
      title: "Unsupported model",
      detail: "Select an enabled model from the server model catalog.",
      instance,
      requestId
    });
  }
  if (error instanceof ProviderConfigurationError) {
    return problemResponse({
      status: 503,
      code: "provider_unavailable",
      title: "AI provider unavailable",
      detail: "The configured AI provider is not available.",
      instance,
      requestId
    });
  }
  if (error instanceof ChatRateLimitError) {
    return problemResponse({
      status: 429,
      code: "rate_limit_exceeded",
      title: "Too many generation requests",
      detail: "Wait briefly before starting another response.",
      instance,
      requestId,
      headers: { "Retry-After": String(error.retryAfterSeconds) }
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return problemResponse({
      status: 409,
      code: "concurrent_generation",
      title: "Concurrent generation conflict",
      detail: "Reload the conversation and try again.",
      instance,
      requestId
    });
  }
  return workspaceErrorResponse(error, instance, requestId);
}
