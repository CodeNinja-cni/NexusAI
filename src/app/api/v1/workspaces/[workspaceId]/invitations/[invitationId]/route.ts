import { z } from "zod";

import {
  getAuthorizedWorkspace,
  workspaceIdSchema
} from "@/modules/workspaces/server/authorization";
import { revokeInvitation } from "@/modules/workspaces/server/workspace-service";
import {
  WorkspaceDomainError,
  invitationEtag,
  requireIfMatch,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { getRequestId } from "@/platform/http/request";
import { prisma } from "@/platform/database/prisma";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ workspaceId: string; invitationId: string }> };

export async function DELETE(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const params = await context.params;
  const instance = `/api/v1/workspaces/${encodeURIComponent(params.workspaceId)}/invitations/${encodeURIComponent(params.invitationId)}`;
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const workspaceId = workspaceIdSchema.safeParse(params.workspaceId);
    const invitationId = z.uuid().safeParse(params.invitationId);
    if (!workspaceId.success || !invitationId.success) throw notFound();
    const membership = await getAuthorizedWorkspace(principal.user.id, workspaceId.data);
    if (!membership) throw notFound();
    if (membership.role === "MEMBER") {
      throw new WorkspaceDomainError(
        403,
        "forbidden",
        "Permission denied",
        "Your workspace role does not allow this operation."
      );
    }
    const current = await prisma.workspaceInvitation.findFirst({
      where: { id: invitationId.data, workspaceId: workspaceId.data },
      select: { id: true, version: true }
    });
    if (!current) throw notFound();
    requireIfMatch(request, invitationEtag(current.id, current.version));
    await revokeInvitation(
      principal.user.id,
      workspaceId.data,
      invitationId.data,
      current.version,
      requestId
    );
    return new Response(null, { status: 204, headers: { "X-Request-Id": requestId } });
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}

function notFound() {
  return new WorkspaceDomainError(
    404,
    "not_found",
    "Invitation not found",
    "The requested invitation is not available."
  );
}
