import { createDocumentDownloadGrant } from "@/modules/documents/server/document-service";
import { documentIdSchema } from "@/modules/documents/server/validation";
import {
  WorkspaceDomainError,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; documentId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/documents/${encodeURIComponent(params.documentId)}/download-url`;
  try {
    requireTrustedMutation(request);
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
    const grant = await createDocumentDownloadGrant(
      principal.user.id,
      params.workspaceId,
      params.documentId
    );
    return Response.json(
      { data: grant, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}
