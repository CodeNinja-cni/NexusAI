import { restoreWorkflow } from "@/modules/workflows/server/workflow-service";
import { workflowErrorResponse } from "@/modules/workflows/server/route-support";
import { workflowIdSchema } from "@/modules/workflows/server/validation";
import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import {
  WorkspaceDomainError,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; workflowId: string }> };

export async function POST(request: Request, context: Context) {
  const { workspaceId, workflowId } = await context.params;
  const requestId = getRequestId(request);
  const instance = `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/restoration`;
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (
      !workspaceIdSchema.safeParse(workspaceId).success ||
      !workflowIdSchema.safeParse(workflowId).success
    )
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workflow not found",
        "The requested workflow is not available."
      );
    const workflow = await restoreWorkflow(principal.user.id, workspaceId, workflowId, requestId);
    return Response.json(
      { data: workflow, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}
