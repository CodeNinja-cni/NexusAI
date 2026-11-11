import { getWorkflowVersion } from "@/modules/workflows/server/workflow-service";
import { workflowErrorResponse } from "@/modules/workflows/server/route-support";
import { workflowIdSchema } from "@/modules/workflows/server/validation";
import {
  requireWorkspacePrincipal,
  WorkspaceDomainError
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  readonly params: Promise<{ workspaceId: string; workflowId: string; versionId: string }>;
};

export async function GET(request: Request, context: Context) {
  const { workspaceId, workflowId, versionId } = await context.params;
  const requestId = getRequestId(request);
  const instance = `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/versions/${versionId}`;
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (![workspaceId, workflowId, versionId].every((id) => workflowIdSchema.safeParse(id).success))
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workflow version not found",
        "The requested workflow version is not available."
      );
    const version = await getWorkflowVersion(principal.user.id, workspaceId, workflowId, versionId);
    return Response.json(
      { data: version, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}
