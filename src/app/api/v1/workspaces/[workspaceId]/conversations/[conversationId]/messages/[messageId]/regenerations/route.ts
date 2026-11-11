import { createGenerationResponse } from "@/modules/chat/server/generation";
import { createRegenerationAttempt } from "@/modules/chat/server/chat-service";
import { consumeChatRateLimit } from "@/modules/chat/server/rate-limit";
import { chatErrorResponse, requireIdempotencyKey } from "@/modules/chat/server/route-support";
import { regenerateMessageSchema, resourceIdSchema } from "@/modules/chat/server/validation";
import { assertChatProviderAvailable } from "@/modules/chat/server/model-catalog";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  readonly params: Promise<{ workspaceId: string; conversationId: string; messageId: string }>;
};

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/conversations/${encodeURIComponent(params.conversationId)}/messages/${encodeURIComponent(params.messageId)}/regenerations`;
  try {
    requireTrustedMutation(request);
    requireIdempotencyKey(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (
      [params.workspaceId, params.conversationId, params.messageId].some(
        (id) => !resourceIdSchema.safeParse(id).success
      )
    )
      throw notFound();
    const body = await parseWorkspaceBody(request, regenerateMessageSchema, instance, requestId);
    if (body instanceof Response) return body;
    if (body.modelKey) assertChatProviderAvailable(body.modelKey);
    await consumeChatRateLimit(principal.user.id, params.workspaceId);
    const attempt = await createRegenerationAttempt(
      principal.user.id,
      params.workspaceId,
      params.conversationId,
      params.messageId,
      body
    );
    return createGenerationResponse(attempt, request.signal, requestId);
  } catch (error) {
    return chatErrorResponse(error, instance, requestId);
  }
}

function notFound() {
  return new WorkspaceDomainError(
    404,
    "not_found",
    "Message not found",
    "The requested message is not available."
  );
}
