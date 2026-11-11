import {
  deleteConversation,
  getConversation,
  updateConversation
} from "@/modules/chat/server/chat-service";
import { chatErrorResponse, conversationEtag } from "@/modules/chat/server/route-support";
import { resourceIdSchema, updateConversationSchema } from "@/modules/chat/server/validation";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireIfMatch,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; conversationId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/conversations/${encodeURIComponent(params.conversationId)}`;
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (
      !resourceIdSchema.safeParse(params.workspaceId).success ||
      !resourceIdSchema.safeParse(params.conversationId).success
    )
      throw notFound();
    const conversation = await getConversation(
      principal.user.id,
      params.workspaceId,
      params.conversationId
    );
    return Response.json(
      { data: conversation, meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: conversationEtag(conversation.id, conversation.version),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return chatErrorResponse(error, instance, requestId);
  }
}

export async function PATCH(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = routeInstance(params);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(params);
    const current = await getConversation(
      principal.user.id,
      params.workspaceId,
      params.conversationId
    );
    requireIfMatch(request, conversationEtag(current.id, current.version));
    const body = await parseWorkspaceBody(request, updateConversationSchema, instance, requestId);
    if (body instanceof Response) return body;
    const conversation = await updateConversation(
      principal.user.id,
      params.workspaceId,
      params.conversationId,
      body,
      current.version,
      requestId
    );
    return Response.json(
      { data: conversation, meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: conversationEtag(conversation.id, conversation.version),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return chatErrorResponse(error, instance, requestId);
  }
}

export async function DELETE(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = routeInstance(params);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(params);
    const current = await getConversation(
      principal.user.id,
      params.workspaceId,
      params.conversationId
    );
    requireIfMatch(request, conversationEtag(current.id, current.version));
    await deleteConversation(
      principal.user.id,
      params.workspaceId,
      params.conversationId,
      current.version,
      requestId
    );
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId }
    });
  } catch (error) {
    return chatErrorResponse(error, instance, requestId);
  }
}

function requireIds(params: { workspaceId: string; conversationId: string }) {
  if (
    !resourceIdSchema.safeParse(params.workspaceId).success ||
    !resourceIdSchema.safeParse(params.conversationId).success
  ) {
    throw notFound();
  }
}

function routeInstance(params: { workspaceId: string; conversationId: string }) {
  return `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/conversations/${encodeURIComponent(params.conversationId)}`;
}

function notFound() {
  return new WorkspaceDomainError(
    404,
    "not_found",
    "Conversation not found",
    "The requested conversation is not available."
  );
}
