import { listWorkflowExecutionLogs } from "@/modules/workflows/server/workflow-service";
import { workflowErrorResponse } from "@/modules/workflows/server/route-support";
import { logListQuerySchema, workflowIdSchema } from "@/modules/workflows/server/validation";
import {
  requireWorkspacePrincipal,
  WorkspaceDomainError
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; executionId: string }> };

export async function GET(request: Request, context: Context) {
  const { workspaceId, executionId } = await context.params;
  const requestId = getRequestId(request);
  const instance = `/api/v1/workspaces/${workspaceId}/workflow-executions/${executionId}/logs`;
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    if (![workspaceId, executionId].every((id) => workflowIdSchema.safeParse(id).success))
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Execution not found",
        "The requested execution is not available."
      );
    const search = new URL(request.url).searchParams;
    const query = logListQuerySchema.safeParse(Object.fromEntries(search));
    if (!query.success) return validationProblem(query.error, instance, requestId);
    const logs = await listWorkflowExecutionLogs(
      principal.user.id,
      workspaceId,
      executionId,
      query.data
    );
    return Response.json(
      { data: logs, meta: { requestId, nextSequence: logs.at(-1)?.sequence ?? null } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}
