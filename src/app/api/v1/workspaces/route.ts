import { createTeamWorkspace, listWorkspaces } from "@/modules/workspaces/server/workspace-service";
import {
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse,
  workspaceEtag
} from "@/modules/workspaces/server/route-support";
import { createWorkspaceSchema } from "@/modules/workspaces/server/validation";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const instance = "/api/v1/workspaces";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const workspaces = await listWorkspaces(principal.user.id);
    return Response.json(
      {
        data: workspaces.items,
        meta: { requestId, selectedWorkspaceId: workspaces.selectedWorkspaceId }
      },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const body = await parseWorkspaceBody(request, createWorkspaceSchema, instance, requestId);
    if (body instanceof Response) return body;
    const workspace = await createTeamWorkspace(principal.user.id, body, requestId);
    return Response.json(
      { data: workspace, meta: { requestId } },
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store",
          ETag: workspaceEtag(workspace.id, workspace.version),
          Location: `/api/v1/workspaces/${workspace.id}`,
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}
