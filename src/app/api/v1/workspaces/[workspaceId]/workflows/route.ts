import { createWorkflow, listWorkflows } from "@/modules/workflows/server/workflow-service";
import {
  createWorkflowSchema,
  workflowListQuerySchema
} from "@/modules/workflows/server/validation";
import { workflowErrorResponse } from "@/modules/workflows/server/route-support";
import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";
import { validationProblem } from "@/platform/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const workspaceId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflows`;
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireUuid(workspaceId);
    const search = new URL(request.url).searchParams;
    const query = workflowListQuerySchema.safeParse(Object.fromEntries(search));
    if (!query.success) return validationProblem(query.error, instance, requestId);
    const result = await listWorkflows(principal.user.id, workspaceId, query.data);
    return Response.json(
      { data: result.items, meta: { requestId, nextCursor: result.nextCursor } },
      { headers: noStore(requestId) }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const workspaceId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflows`;
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireUuid(workspaceId);
    const body = await parseWorkspaceBody(request, createWorkflowSchema, instance, requestId);
    if (body instanceof Response) return body;
    const workflow = await createWorkflow(principal.user.id, workspaceId, body, requestId);
    return Response.json(
      { data: workflow, meta: { requestId } },
      { status: 201, headers: { ...noStore(requestId), Location: `/workflows/${workflow.id}` } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}

function requireUuid(value: string) {
  if (!workspaceIdSchema.safeParse(value).success)
    throw new WorkspaceDomainError(
      404,
      "not_found",
      "Workspace not found",
      "The requested workspace is not available."
    );
}
function noStore(requestId: string) {
  return { "Cache-Control": "private, no-store", "X-Request-Id": requestId };
}
