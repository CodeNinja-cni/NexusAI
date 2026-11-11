import {
  listWorkflowExecutions,
  startWorkflowExecution
} from "@/modules/workflows/server/workflow-service";
import {
  requireIdempotencyKey,
  workflowErrorResponse
} from "@/modules/workflows/server/route-support";
import {
  executeWorkflowSchema,
  executionListQuerySchema,
  workflowIdSchema
} from "@/modules/workflows/server/validation";
import {
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  WorkspaceDomainError
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; workflowId: string }> };

export async function GET(request: Request, context: Context) {
  const { workspaceId, workflowId } = await context.params;
  const requestId = getRequestId(request);
  const instance = routePath(workspaceId, workflowId);
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(workspaceId, workflowId);
    const search = new URL(request.url).searchParams;
    const query = executionListQuerySchema.safeParse(Object.fromEntries(search));
    if (!query.success) return validationProblem(query.error, instance, requestId);
    const result = await listWorkflowExecutions(
      principal.user.id,
      workspaceId,
      workflowId,
      query.data
    );
    return Response.json(
      { data: result.items, meta: { requestId, nextCursor: result.nextCursor } },
      { headers: noStore(requestId) }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const { workspaceId, workflowId } = await context.params;
  const requestId = getRequestId(request);
  const instance = routePath(workspaceId, workflowId);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(workspaceId, workflowId);
    const key = requireIdempotencyKey(request);
    const body = await parseWorkspaceBody(request, executeWorkflowSchema, instance, requestId);
    if (body instanceof Response) return body;
    const execution = await startWorkflowExecution(
      principal.user.id,
      workspaceId,
      workflowId,
      body.input,
      key,
      requestId
    );
    return Response.json(
      { data: execution, meta: { requestId } },
      { status: 202, headers: noStore(requestId) }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}

function requireIds(workspaceId: string, workflowId: string) {
  if (![workspaceId, workflowId].every((id) => workflowIdSchema.safeParse(id).success))
    throw new WorkspaceDomainError(
      404,
      "not_found",
      "Workflow not found",
      "The requested workflow is not available."
    );
}
function routePath(workspaceId: string, workflowId: string) {
  return `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions`;
}
function noStore(requestId: string) {
  return { "Cache-Control": "private, no-store", "X-Request-Id": requestId };
}
