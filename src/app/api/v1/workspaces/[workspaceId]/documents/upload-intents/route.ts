import { createDocumentUploadIntent } from "@/modules/documents/server/document-service";
import { createUploadIntentSchema } from "@/modules/documents/server/validation";
import { requireIdempotencyKey } from "@/modules/chat/server/route-support";
import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const workspaceId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/documents/upload-intents`;
  try {
    requireTrustedMutation(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (!workspaceIdSchema.safeParse(workspaceId).success) throw notFound();
    const body = await parseWorkspaceBody(request, createUploadIntentSchema, instance, requestId);
    if (body instanceof Response) return body;
    const result = await createDocumentUploadIntent(
      principal.user.id,
      workspaceId,
      body,
      idempotencyKey,
      requestId
    );
    return Response.json(
      { data: result, meta: { requestId } },
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store",
          Location: `${instance.replace("/upload-intents", "")}/${result.document.id}`,
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
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
