import { getWorkflowExecution } from "@/modules/workflows/server/workflow-service";
import { workflowErrorResponse } from "@/modules/workflows/server/route-support";
import { workflowIdSchema } from "@/modules/workflows/server/validation";
import {
  requireWorkspacePrincipal,
  WorkspaceDomainError
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; executionId: string }> };

export async function GET(request: Request, context: Context) {
  const { workspaceId, executionId } = await context.params;
  const requestId = getRequestId(request);
  const instance = routePath(workspaceId, executionId);
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(workspaceId, executionId);
    const execution = await getWorkflowExecution(principal.user.id, workspaceId, executionId);
    return Response.json(
      { data: execution, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}

function requireIds(workspaceId: string, executionId: string) {
  if (![workspaceId, executionId].every((id) => workflowIdSchema.safeParse(id).success))
    throw new WorkspaceDomainError(
      404,
      "not_found",
      "Execution not found",
      "The requested execution is not available."
    );
}
function routePath(workspaceId: string, executionId: string) {
  return `/api/v1/workspaces/${workspaceId}/workflow-executions/${executionId}`;
}
