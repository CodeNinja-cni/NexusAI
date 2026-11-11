import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import { selectWorkspace } from "@/modules/workspaces/server/workspace-service";
import {
  WorkspaceDomainError,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const unsafeId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(unsafeId)}/selection`;
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const parsed = workspaceIdSchema.safeParse(unsafeId);
    if (!parsed.success)
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    const workspace = await selectWorkspace(principal.user.id, parsed.data, requestId);
    return Response.json(
      { data: workspace, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}
