import { restoreConversation } from "@/modules/chat/server/chat-service";
import {
  chatErrorResponse,
  conversationEtag,
  requireIdempotencyKey
} from "@/modules/chat/server/route-support";
import { resourceIdSchema } from "@/modules/chat/server/validation";
import {
  WorkspaceDomainError,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ workspaceId: string; conversationId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/conversations/${encodeURIComponent(params.conversationId)}/restoration`;
  try {
    requireTrustedMutation(request);
    requireIdempotencyKey(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (
      !resourceIdSchema.safeParse(params.workspaceId).success ||
      !resourceIdSchema.safeParse(params.conversationId).success
    ) {
      throw notFound();
    }
    const conversation = await restoreConversation(
      principal.user.id,
      params.workspaceId,
      params.conversationId,
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

function notFound() {
  return new WorkspaceDomainError(
    404,
    "not_found",
    "Conversation not found",
    "The requested conversation is not available."
  );
}
