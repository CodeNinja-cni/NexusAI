import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import { listMembers } from "@/modules/workspaces/server/workspace-service";
import {
  WorkspaceDomainError,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const unsafeId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(unsafeId)}/members`;
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const parsed = workspaceIdSchema.safeParse(unsafeId);
    if (!parsed.success) throw notFound();
    const result = await listMembers(principal.user.id, parsed.data);
    return Response.json(
      { data: result.items, meta: { requestId, callerRole: result.callerRole } },
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
