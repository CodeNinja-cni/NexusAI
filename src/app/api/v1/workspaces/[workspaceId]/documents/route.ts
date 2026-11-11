import { listDocuments } from "@/modules/documents/server/document-service";
import { documentListQuerySchema } from "@/modules/documents/server/validation";
import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import {
  WorkspaceDomainError,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const workspaceId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/documents`;
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (!workspaceIdSchema.safeParse(workspaceId).success) throw notFound();
    const search = new URL(request.url).searchParams;
    const query = documentListQuerySchema.safeParse(Object.fromEntries(search));
    if (!query.success) return validationProblem(query.error, instance, requestId);
    const result = await listDocuments(principal.user.id, workspaceId, query.data);
    return Response.json(
      { data: result.items, meta: { requestId, nextCursor: result.nextCursor } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
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
