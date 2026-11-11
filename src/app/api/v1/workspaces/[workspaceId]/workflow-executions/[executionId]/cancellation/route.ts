import { cancelWorkflowExecution } from "@/modules/workflows/server/workflow-service";
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
type Context = { readonly params: Promise<{ workspaceId: string; executionId: string }> };

export async function POST(request: Request, context: Context) {
  const { workspaceId, executionId } = await context.params;
  const requestId = getRequestId(request);
  const instance = `/api/v1/workspaces/${workspaceId}/workflow-executions/${executionId}/cancellation`;
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (![workspaceId, executionId].every((id) => workflowIdSchema.safeParse(id).success))
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Execution not found",
        "The requested execution is not available."
      );
    const execution = await cancelWorkflowExecution(
      principal.user.id,
      workspaceId,
      executionId,
      requestId
    );
    return Response.json(
      { data: execution, meta: { requestId } },
      { status: 202, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}
