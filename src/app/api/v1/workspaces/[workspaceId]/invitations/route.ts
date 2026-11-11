import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import { createInvitation, listInvitations } from "@/modules/workspaces/server/workspace-service";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { invitationSchema } from "@/modules/workspaces/server/validation";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ workspaceId: string }> };

async function values(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const unsafeId = (await context.params).workspaceId;
  const parsed = workspaceIdSchema.safeParse(unsafeId);
  if (!parsed.success)
    throw new WorkspaceDomainError(
      404,
      "not_found",
      "Workspace not found",
      "The requested workspace is not available."
    );
  return {
    requestId,
    workspaceId: parsed.data,
    instance: `/api/v1/workspaces/${encodeURIComponent(unsafeId)}/invitations`
  };
}

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  let instance = "/api/v1/workspaces/invalid/invitations";
  try {
    const route = await values(request, context);
    instance = route.instance;
    const principal = await requireWorkspacePrincipal(request, instance, route.requestId);
    const items = await listInvitations(principal.user.id, route.workspaceId);
    return Response.json(
      { data: items, meta: { requestId: route.requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": route.requestId } }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  let instance = "/api/v1/workspaces/invalid/invitations";
  try {
    requireTrustedMutation(request);
    const route = await values(request, context);
    instance = route.instance;
    const principal = await requireWorkspacePrincipal(request, instance, route.requestId);
    const body = await parseWorkspaceBody(request, invitationSchema, instance, route.requestId);
    if (body instanceof Response) return body;
    await createInvitation(principal.user.id, route.workspaceId, body, route.requestId);
    return Response.json(
      { data: { accepted: true }, meta: { requestId: route.requestId } },
      {
        status: 202,
        headers: { "Cache-Control": "private, no-store", "X-Request-Id": route.requestId }
      }
    );
  } catch (error) {
    return workspaceErrorResponse(error, instance, requestId);
  }
}
