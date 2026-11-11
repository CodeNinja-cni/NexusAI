import { acceptInvitation } from "@/modules/workspaces/server/workspace-service";
import {
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { acceptInvitationSchema } from "@/modules/workspaces/server/validation";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
const instance = "/api/v1/workspace-invitations/accept";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const body = await parseWorkspaceBody(request, acceptInvitationSchema, instance, requestId);
    if (body instanceof Response) return body;
    const result = await acceptInvitation(
      principal.user.id,
      principal.user.email,
      body.token,
      requestId
    );
    return Response.json(
      { data: result, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}
