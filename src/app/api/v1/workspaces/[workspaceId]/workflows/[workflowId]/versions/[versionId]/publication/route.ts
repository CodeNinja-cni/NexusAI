import { publishWorkflowVersion } from "@/modules/workflows/server/workflow-service";
import { workflowErrorResponse } from "@/modules/workflows/server/route-support";
import { workflowIdSchema } from "@/modules/workflows/server/validation";
import {
  requireTrustedMutation,
  requireWorkspacePrincipal,
  WorkspaceDomainError
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  readonly params: Promise<{ workspaceId: string; workflowId: string; versionId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { workspaceId, workflowId, versionId } = await context.params;
  const requestId = getRequestId(request);
  const instance = `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/versions/${versionId}/publication`;
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (![workspaceId, workflowId, versionId].every((id) => workflowIdSchema.safeParse(id).success))
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workflow version not found",
        "The requested workflow version is not available."
      );
    const workflow = await publishWorkflowVersion(
      principal.user.id,
      workspaceId,
      workflowId,
      versionId,
      requestId
    );
    return Response.json(
      { data: workflow, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}
