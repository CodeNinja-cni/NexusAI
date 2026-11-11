import {
  deleteWorkflow,
  getWorkflow,
  updateWorkflow,
  workflowEtag
} from "@/modules/workflows/server/workflow-service";
import { workflowErrorResponse } from "@/modules/workflows/server/route-support";
import { updateWorkflowSchema, workflowIdSchema } from "@/modules/workflows/server/validation";
import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireIfMatch,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string; workflowId: string }> };

export async function GET(request: Request, context: Context) {
  const { workspaceId, workflowId } = await context.params;
  const requestId = getRequestId(request);
  const instance = path(workspaceId, workflowId);
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(workspaceId, workflowId);
    const workflow = await getWorkflow(principal.user.id, workspaceId, workflowId);
    return Response.json(
      { data: workflow, meta: { requestId } },
      { headers: { ...noStore(requestId), ETag: workflow.etag } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}

export async function PATCH(request: Request, context: Context) {
  const { workspaceId, workflowId } = await context.params;
  const requestId = getRequestId(request);
  const instance = path(workspaceId, workflowId);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(workspaceId, workflowId);
    const current = await getWorkflow(principal.user.id, workspaceId, workflowId);
    requireIfMatch(request, workflowEtag(workflowId, Number(current.version)));
    const body = await parseWorkspaceBody(request, updateWorkflowSchema, instance, requestId);
    if (body instanceof Response) return body;
    const workflow = await updateWorkflow(
      principal.user.id,
      workspaceId,
      workflowId,
      body,
      Number(current.version),
      requestId
    );
    return Response.json(
      { data: workflow, meta: { requestId } },
      { headers: { ...noStore(requestId), ETag: workflow.etag } }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}

export async function DELETE(request: Request, context: Context) {
  const { workspaceId, workflowId } = await context.params;
  const requestId = getRequestId(request);
  const instance = path(workspaceId, workflowId);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(workspaceId, workflowId);
    const current = await getWorkflow(principal.user.id, workspaceId, workflowId);
    requireIfMatch(request, workflowEtag(workflowId, Number(current.version)));
    const result = await deleteWorkflow(
      principal.user.id,
      workspaceId,
      workflowId,
      Number(current.version),
      requestId
    );
    return Response.json(
      { data: result, meta: { requestId } },
      { status: 202, headers: noStore(requestId) }
    );
  } catch (error) {
    return workflowErrorResponse(error, instance, requestId);
  }
}

function requireIds(workspaceId: string, workflowId: string) {
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
}
function path(workspaceId: string, workflowId: string) {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}`;
}
function noStore(requestId: string) {
  return { "Cache-Control": "private, no-store", "X-Request-Id": requestId };
}
