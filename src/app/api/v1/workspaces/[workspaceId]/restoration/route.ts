import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import { restoreWorkspace } from "@/modules/workspaces/server/workspace-service";
import {
  WorkspaceDomainError,
  requireFreshSession,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse,
  workspaceEtag
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const unsafeId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(unsafeId)}/restoration`;
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireFreshSession(principal);
    const parsed = workspaceIdSchema.safeParse(unsafeId);
    if (!parsed.success)
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    const workspace = await restoreWorkspace(principal.user.id, parsed.data, requestId);
    return Response.json(
      { data: workspace, meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: workspaceEtag(workspace.id, workspace.version),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}
