import {
  getQuotaSnapshot,
  updateUsageQuotaPolicy,
  usagePolicyEtag
} from "@/modules/usage/server/quota";
import { usageErrorResponse } from "@/modules/usage/server/route-support";
import { updateUsageQuotaSchema, usageQuotaQuerySchema } from "@/modules/usage/server/validation";
import {
  parseWorkspaceBody,
  requireIfMatch,
  requireTrustedMutation,
  requireWorkspacePrincipal
} from "@/modules/workspaces/server/route-support";
import { validationProblem } from "@/platform/http/problem";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const instance = "/api/v1/usage/quota";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const workspaceId = parseWorkspaceId(request, requestId);
    if (workspaceId instanceof Response) return workspaceId;
    const quota = await getQuotaSnapshot(principal.user.id, workspaceId);
    return Response.json(
      { data: quota, meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: usagePolicyEtag(workspaceId, quota.policyVersion),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return usageErrorResponse(error, instance, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    requireTrustedMutation(request);
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const workspaceId = parseWorkspaceId(request, requestId);
    if (workspaceId instanceof Response) return workspaceId;
    const current = await getQuotaSnapshot(principal.user.id, workspaceId);
    requireIfMatch(request, usagePolicyEtag(workspaceId, current.policyVersion));
    const body = await parseWorkspaceBody(request, updateUsageQuotaSchema, instance, requestId);
    if (body instanceof Response) return body;
    const quota = await updateUsageQuotaPolicy(
      principal.user.id,
      workspaceId,
      body,
      current.policyVersion,
      requestId
    );
    return Response.json(
      { data: quota, meta: { requestId } },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ETag: usagePolicyEtag(workspaceId, quota.policyVersion),
          "X-Request-Id": requestId
        }
      }
    );
  } catch (error) {
    return usageErrorResponse(error, instance, requestId);
  }
}

function parseWorkspaceId(request: Request, requestId: string) {
  const search = new URL(request.url).searchParams;
  const query = usageQuotaQuerySchema.safeParse(Object.fromEntries(search));
  return query.success
    ? query.data.workspaceId
    : validationProblem(query.error, instance, requestId);
}
