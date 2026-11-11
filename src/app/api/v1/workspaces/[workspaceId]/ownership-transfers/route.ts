import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import { transferOwnership } from "@/modules/workspaces/server/workspace-service";
import {
  WorkspaceDomainError,
  parseWorkspaceBody,
  requireFreshSession,
  requireTrustedMutation,
  requireWorkspacePrincipal,
  workspaceErrorResponse
} from "@/modules/workspaces/server/route-support";
import { ownershipTransferSchema } from "@/modules/workspaces/server/validation";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const unsafeId = (await context.params).workspaceId;
  const instance = `/api/v1/workspaces/${encodeURIComponent(unsafeId)}/ownership-transfers`;
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    requireFreshSession(principal);
    const workspaceId = workspaceIdSchema.safeParse(unsafeId);
    if (!workspaceId.success)
      throw new WorkspaceDomainError(
        404,
        "not_found",
        "Workspace not found",
        "The requested workspace is not available."
      );
    const body = await parseWorkspaceBody(request, ownershipTransferSchema, instance, requestId);
    if (body instanceof Response) return body;
    const result = await transferOwnership(
      principal.user.id,
      workspaceId.data,
      body.newOwnerUserId,
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
