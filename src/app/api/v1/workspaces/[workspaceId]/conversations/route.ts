import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { createConversation, listConversations } from "@/modules/chat/server/chat-service";
import { chatErrorResponse, requireIdempotencyKey } from "@/modules/chat/server/route-support";
import {
  conversationListQuerySchema,
  createConversationSchema
} from "@/modules/chat/server/validation";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const unsafeWorkspaceId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(unsafeWorkspaceId)}/conversations`;
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const workspaceId = workspaceIdSchema.safeParse(unsafeWorkspaceId);
    if (!workspaceId.success) throw notFound();
    const searchParams = new URL(request.url).searchParams;
    const query = conversationListQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!query.success) return validationProblem(query.error, instance, requestId);
    const conversations = await listConversations(principal.user.id, workspaceId.data, query.data);
    return Response.json(
      {
        data: conversations.items,
        meta: { requestId, nextCursor: conversations.nextCursor }
      },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return chatErrorResponse(error, instance, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const unsafeWorkspaceId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(unsafeWorkspaceId)}/conversations`;
  try {
    requireTrustedMutation(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const workspaceId = workspaceIdSchema.safeParse(unsafeWorkspaceId);
    if (!workspaceId.success) throw notFound();
    const body = await parseWorkspaceBody(request, createConversationSchema, instance, requestId);
    if (body instanceof Response) return body;
    const conversation = await createConversation(
      principal.user.id,
      workspaceId.data,
      body,
      requestId,
      idempotencyKey
    );
    return Response.json(
      { data: conversation, meta: { requestId } },
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store",
          Location: `${instance}/${conversation.id}`,
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
    "Workspace not found",
    "The requested workspace is not available."
  );
}
