import "server-only";

import {
  WorkspaceDomainError,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";

import { UsageRangeError } from "./validation";

export function usageErrorResponse(error: unknown, instance: string, requestId: string): Response {
  if (error instanceof UsageRangeError) {
    return workspaceErrorResponse(
      new WorkspaceDomainError(422, "invalid_usage_range", "Invalid usage range", error.message),
      instance,
      requestId
    );
  }
  return workspaceErrorResponse(error, instance, requestId);
}
