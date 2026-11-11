import { createGenerationResponse } from "@/modules/chat/server/generation";
import { createMessageAttempt, listMessages } from "@/modules/chat/server/chat-service";
import { chatErrorResponse, requireIdempotencyKey } from "@/modules/chat/server/route-support";
import {
  createMessageSchema,
  messageListQuerySchema,
  resourceIdSchema
} from "@/modules/chat/server/validation";
import { consumeChatRateLimit } from "@/modules/chat/server/rate-limit";
import { assertChatProviderAvailable } from "@/modules/chat/server/model-catalog";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; conversationId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = routeInstance(params);
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(params);
    const searchParams = new URL(request.url).searchParams;
    const query = messageListQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!query.success) return validationProblem(query.error, instance, requestId);
    const messages = await listMessages(
      principal.user.id,
      params.workspaceId,
      params.conversationId,
      query.data
    );
    return Response.json(
      { data: messages.items, meta: { requestId, nextCursor: messages.nextCursor } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return chatErrorResponse(error, instance, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = routeInstance(params);
  try {
    requireTrustedMutation(request);
    requireIdempotencyKey(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(params);
    const body = await parseWorkspaceBody(request, createMessageSchema, instance, requestId);
    if (body instanceof Response) return body;
    assertChatProviderAvailable(body.modelKey);
    await consumeChatRateLimit(principal.user.id, params.workspaceId);
    const attempt = await createMessageAttempt(
      principal.user.id,
      params.workspaceId,
      params.conversationId,
      body
    );
    return createGenerationResponse(attempt, request.signal, requestId);
  } catch (error) {
    return chatErrorResponse(error, instance, requestId);
  }
}

function requireIds(params: { workspaceId: string; conversationId: string }) {
  if (
    !resourceIdSchema.safeParse(params.workspaceId).success ||
    !resourceIdSchema.safeParse(params.conversationId).success
  ) {
    throw new WorkspaceDomainError(
      404,
      "not_found",
      "Conversation not found",
      "The requested conversation is not available."
    );
  }
}

function routeInstance(params: { workspaceId: string; conversationId: string }) {
  return `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/conversations/${encodeURIComponent(params.conversationId)}/messages`;
}
