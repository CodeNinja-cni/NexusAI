import { randomUUID } from "node:crypto";

import { createConversation, createMessageAttempt } from "@/modules/chat/server/chat-service";
import { createGenerationResponse } from "@/modules/chat/server/generation";
import { assertChatProviderAvailable } from "@/modules/chat/server/model-catalog";
import { consumeChatRateLimit } from "@/modules/chat/server/rate-limit";
import { chatErrorResponse, requireIdempotencyKey } from "@/modules/chat/server/route-support";
import { documentIdSchema, documentQuestionSchema } from "@/modules/documents/server/validation";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; documentId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/documents/${encodeURIComponent(params.documentId)}/questions`;
  try {
    requireTrustedMutation(request);
    requireIdempotencyKey(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (
      !documentIdSchema.safeParse(params.workspaceId).success ||
      !documentIdSchema.safeParse(params.documentId).success
    )
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Document not found",
        "The requested document is not available."
      );
    const body = await parseWorkspaceBody(request, documentQuestionSchema, instance, requestId);
    if (body instanceof Response) return body;
    assertChatProviderAvailable(body.modelKey);
    await consumeChatRateLimit(principal.user.id, params.workspaceId);
    let conversationId = body.conversationId;
    if (!conversationId) {
      conversationId = randomUUID();
      await createConversation(
        principal.user.id,
        params.workspaceId,
        {
          title: body.question.slice(0, 200),
          modelKey: body.modelKey,
          documentIds: [params.documentId]
        },
        requestId,
        conversationId
      );
    }
    const attempt = await createMessageAttempt(
      principal.user.id,
      params.workspaceId,
      conversationId,
      {
        clientMessageId: body.clientMessageId,
        content: body.question,
        modelKey: body.modelKey,
        documentIds: [params.documentId]
      }
    );
    return createGenerationResponse(attempt, request.signal, requestId);
  } catch (error) {
    return chatErrorResponse(error, instance, requestId);
  }
}
