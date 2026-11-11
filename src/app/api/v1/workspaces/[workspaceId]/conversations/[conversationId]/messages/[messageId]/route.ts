import { chatErrorResponse } from "@/modules/chat/server/route-support";
import { resourceIdSchema } from "@/modules/chat/server/validation";
import { serializeMessage } from "@/modules/chat/server/serialization";
import {
  WorkspaceDomainError,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { prisma } from "@/platform/database/prisma";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  readonly params: Promise<{ workspaceId: string; conversationId: string; messageId: string }>;
};

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/conversations/${encodeURIComponent(params.conversationId)}/messages/${encodeURIComponent(params.messageId)}`;
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (
      [params.workspaceId, params.conversationId, params.messageId].some(
        (id) => !resourceIdSchema.safeParse(id).success
      )
    )
      throw notFound();
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: params.workspaceId, userId: principal.user.id },
        workspace: { status: "ACTIVE", deletedAt: null }
      },
      select: { id: true }
    });
    if (!membership) throw notFound();
    const message = await prisma.message.findUnique({
      where: {
        id_conversationId_workspaceId: {
          id: params.messageId,
          conversationId: params.conversationId,
          workspaceId: params.workspaceId
        }
      }
    });
    if (!message || (message.role !== "USER" && message.role !== "ASSISTANT")) throw notFound();
    return Response.json(
      { data: serializeMessage(message), meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
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
