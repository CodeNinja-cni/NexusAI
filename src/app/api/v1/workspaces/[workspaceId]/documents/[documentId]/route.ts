import {
  deleteDocument,
  documentEtag,
  getDocument,
  updateDocument
} from "@/modules/documents/server/document-service";
import { documentIdSchema, updateDocumentSchema } from "@/modules/documents/server/validation";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireIfMatch,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; documentId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = routeInstance(params);
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(params);
    const document = await getDocument(principal.user.id, params.workspaceId, params.documentId);
    return Response.json(
      { data: document, meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: documentEtag(document.id, document.version),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
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
    const current = await getDocument(principal.user.id, params.workspaceId, params.documentId);
    requireIfMatch(request, documentEtag(current.id, current.version));
    const body = await parseWorkspaceBody(request, updateDocumentSchema, instance, requestId);
    if (body instanceof Response) return body;
    const document = await updateDocument(
      principal.user.id,
      params.workspaceId,
      params.documentId,
      body.name,
      current.version,
      requestId
    );
    return Response.json(
      { data: document, meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: documentEtag(document.id, document.version),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
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
    const current = await getDocument(principal.user.id, params.workspaceId, params.documentId);
    requireIfMatch(request, documentEtag(current.id, current.version));
    await deleteDocument(
      principal.user.id,
      params.workspaceId,
      params.documentId,
      current.version,
      requestId
    );
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId }
    });
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
  return `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/documents/${encodeURIComponent(params.documentId)}`;
}
