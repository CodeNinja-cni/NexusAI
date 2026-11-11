import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import {
  deleteWorkspace,
  getWorkspace,
  renameWorkspace
} from "@/modules/workspaces/server/workspace-service";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireFreshSession,
  requireIfMatch,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse,
  workspaceEtag
} from "@/modules/workspaces/server/route-support";
import { updateWorkspaceSchema } from "@/modules/workspaces/server/validation";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ workspaceId: string }> };

async function routeValues(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const unsafeId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(unsafeId)}`;
  const parsed = workspaceIdSchema.safeParse(unsafeId);
  if (!parsed.success) return { requestId, instance, workspaceId: null };
  return { requestId, instance, workspaceId: parsed.data };
}

export async function GET(request: Request, context: Context) {
  const values = await routeValues(request, context);
  try {
    const principal = await requireWorkspacePrincipal(request, values.instance, values.requestId);
    if (!values.workspaceId)
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    const workspace = await getWorkspace(principal.user.id, values.workspaceId);
    return Response.json(
      { data: workspace, meta: { requestId: values.requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: workspaceEtag(workspace.id, workspace.version),
          "X-Request-Id": values.requestId
        }
      }
    );
  } catch (error) {
    if (!values.workspaceId) {
      return Response.json(
        {
          type: "https://nexus.local/problems/not-found",
          title: "Workspace not found",
          status: 404,
          detail: "The requested workspace is not available.",
          instance: values.instance,
          code: "not_found",
          requestId: values.requestId
        },
        { status: 404, headers: { "Content-Type": "application/problem+json" } }
      );
    }
    return workspaceErrorResponse(error, values.instance, values.requestId);
  }
}

export async function PATCH(request: Request, context: Context) {
  const values = await routeValues(request, context);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, values.instance, values.requestId);
    if (!values.workspaceId)
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    const current = await getWorkspace(principal.user.id, values.workspaceId);
    requireIfMatch(request, workspaceEtag(current.id, current.version));
    const body = await parseWorkspaceBody(
      request,
      updateWorkspaceSchema,
      values.instance,
      values.requestId
    );
    if (body instanceof Response) return body;
    const workspace = await renameWorkspace(
      principal.user.id,
      values.workspaceId,
      body,
      current.version,
      values.requestId
    );
    return Response.json(
      { data: workspace, meta: { requestId: values.requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: workspaceEtag(workspace.id, workspace.version),
          "X-Request-Id": values.requestId
        }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, values.instance, values.requestId);
  }
}

export async function DELETE(request: Request, context: Context) {
  const values = await routeValues(request, context);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, values.instance, values.requestId);
    requireFreshSession(principal);
    if (!values.workspaceId)
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    const current = await getWorkspace(principal.user.id, values.workspaceId);
    requireIfMatch(request, workspaceEtag(current.id, current.version));
    const workspace = await deleteWorkspace(
      principal.user.id,
      values.workspaceId,
      current.version,
      values.requestId
    );
    return Response.json(
      { data: workspace, meta: { requestId: values.requestId } },
      {
        status: 202,
        headers: {
          "Cache-Control": "private, no-store",
          ETag: workspaceEtag(workspace.id, workspace.version),
          "X-Request-Id": values.requestId
        }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, values.instance, values.requestId);
  }
}
