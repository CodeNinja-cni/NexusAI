import { requestGenerationCancellation } from "@/modules/chat/server/chat-service";
import { chatErrorResponse, requireIdempotencyKey } from "@/modules/chat/server/route-support";
import { resourceIdSchema } from "@/modules/chat/server/validation";
import {
  WorkspaceDomainError,
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
  const instance = `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/conversations/${encodeURIComponent(params.conversationId)}/generations/${encodeURIComponent(params.messageId)}/cancellation`;
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
    const result = await requestGenerationCancellation(
      principal.user.id,
      params.workspaceId,
      params.conversationId,
      params.messageId
    );
    return Response.json(
      { data: result, meta: { requestId } },
      { status: 202, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
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
