import {
  getAuthorizedWorkspace,
  workspaceIdSchema
} from "@/modules/workspaces/server/authorization";
import { removeMember, updateMemberRole } from "@/modules/workspaces/server/workspace-service";
import {
  WorkspaceDomainError,
  memberEtag,
  parseWorkspaceBody,
  requireIfMatch,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { memberRoleSchema } from "@/modules/workspaces/server/validation";
import { getRequestId } from "@/platform/http/request";
import { prisma } from "@/platform/database/prisma";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ workspaceId: string; memberUserId: string }> };

async function values(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  return {
    requestId,
    workspaceId: workspaceIdSchema.safeParse(params.workspaceId),
    memberUserId: params.memberUserId,
    instance: `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/members/${encodeURIComponent(params.memberUserId)}`
  };
}

async function currentMember(workspaceId: string, memberUserId: string) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: memberUserId } },
    select: { id: true, version: true }
  });
  if (!member)
    throw new WorkspaceDomainError(
      404,
      "not_found",
      "Member not found",
      "The requested member is not available."
    );
  return member;
}

export async function PATCH(request: Request, context: Context) {
  const route = await values(request, context);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, route.instance, route.requestId);
    if (!route.workspaceId.success)
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    if (!(await getAuthorizedWorkspace(principal.user.id, route.workspaceId.data))) {
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    }
    const current = await currentMember(route.workspaceId.data, route.memberUserId);
    requireIfMatch(request, memberEtag(current.id, current.version));
    const body = await parseWorkspaceBody(
      request,
      memberRoleSchema,
      route.instance,
      route.requestId
    );
    if (body instanceof Response) return body;
    const member = await updateMemberRole(
      principal.user.id,
      route.workspaceId.data,
      route.memberUserId,
      body.role,
      current.version,
      route.requestId
    );
    return Response.json(
      { data: member, meta: { requestId: route.requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: memberEtag(member.id, member.version),
          "X-Request-Id": route.requestId
        }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, route.instance, route.requestId);
  }
}

export async function DELETE(request: Request, context: Context) {
  const route = await values(request, context);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, route.instance, route.requestId);
    if (!route.workspaceId.success)
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    if (!(await getAuthorizedWorkspace(principal.user.id, route.workspaceId.data))) {
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    }
    const current = await currentMember(route.workspaceId.data, route.memberUserId);
    requireIfMatch(request, memberEtag(current.id, current.version));
    await removeMember(
      principal.user.id,
      route.workspaceId.data,
      route.memberUserId,
      current.version,
      route.requestId
    );
    return new Response(null, { status: 204, headers: { "X-Request-Id": route.requestId } });
  } catch (error) {
    return workspaceErrorResponse(error, route.instance, route.requestId);
  }
}
