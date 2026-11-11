import {
  createWorkflowVersion,
  listWorkflowVersions
} from "@/modules/workflows/server/workflow-service";
import { workflowErrorResponse } from "@/modules/workflows/server/route-support";
import {
  createWorkflowVersionSchema,
  workflowIdSchema
} from "@/modules/workflows/server/validation";
import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
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
  const instance = routePath(workspaceId, workflowId);
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireIds(workspaceId, workflowId);
    const versions = await listWorkflowVersions(principal.user.id, workspaceId, workflowId);
    return Response.json({ data: versions, meta: { requestId } }, { headers: noStore(requestId) });
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
    const body = await parseWorkspaceBody(
      request,
      createWorkflowVersionSchema,
      instance,
      requestId,
      1024 * 1024
    );
    if (body instanceof Response) return body;
    const version = await createWorkflowVersion(
      principal.user.id,
      workspaceId,
      workflowId,
      body.definition,
      requestId
    );
    return Response.json(
      { data: version, meta: { requestId } },
      { status: 201, headers: noStore(requestId) }
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
function routePath(workspaceId: string, workflowId: string) {
  return `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/versions`;
}
function noStore(requestId: string) {
  return { "Cache-Control": "private, no-store", "X-Request-Id": requestId };
}
