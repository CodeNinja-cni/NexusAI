import "server-only";

import { UnsupportedChatModelError } from "@/modules/chat/server/model-catalog";
import {
  WorkspaceDomainError,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { problemResponse } from "@/platform/http/problem";

import { WorkflowDefinitionError } from "./definition";

export function workflowErrorResponse(
  error: unknown,
  instance: string,
  requestId: string
): Response {
  if (error instanceof WorkflowDefinitionError) {
    return problemResponse({
      status: 422,
      code: error.code,
      title: "Workflow definition is invalid",
      detail: error.message,
      instance,
      requestId,
      errors: [{ path: error.path.join("."), code: error.code, message: error.message }]
    });
  }
  if (error instanceof UnsupportedChatModelError) {
    return problemResponse({
      status: 422,
      code: "workflow_model_unavailable",
      title: "Workflow model is unavailable",
      detail: "Choose an enabled model before publishing this workflow.",
      instance,
      requestId
    });
  }
  return workspaceErrorResponse(error, instance, requestId);
}

export function requireIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || value.length > 128 || !/^[a-zA-Z0-9._:-]+$/u.test(value)) {
    throw new WorkspaceDomainError(
      400,
      "idempotency_key_required",
      "Valid Idempotency-Key required",
      "Provide a unique Idempotency-Key containing up to 128 letters, numbers, dots, colons, underscores, or hyphens."
    );
  }
  return value;
}
