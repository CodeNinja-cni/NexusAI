import { completeDocumentUpload } from "@/modules/documents/server/document-service";
import { completeUploadSchema, documentIdSchema } from "@/modules/documents/server/validation";
import {
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse,
  WorkspaceDomainError
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; documentId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = routeInstance(params);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(params);
    const body = await parseWorkspaceBody(request, completeUploadSchema, instance, requestId);
    if (body instanceof Response) return body;
    const document = await completeDocumentUpload(
      principal.user.id,
      params.workspaceId,
      params.documentId,
      body.sha256,
      requestId
    );
    return Response.json(
      { data: document, meta: { requestId } },
      { status: 202, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}

function requireIds(params: { workspaceId: string; documentId: string }) {
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
}
function routeInstance(params: { workspaceId: string; documentId: string }) {
  return `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/documents/${encodeURIComponent(params.documentId)}/upload-completion`;
}
