import { getUsageSummary } from "@/modules/usage/server/analytics";
import { usageErrorResponse } from "@/modules/usage/server/route-support";
import { parseUsageRange, usageSummaryQuerySchema } from "@/modules/usage/server/validation";
import { requireWorkspacePrincipal } from "@/modules/workspaces/server/route-support";
import { validationProblem } from "@/platform/http/problem";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/usage/summary";
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const search = new URL(request.url).searchParams;
    const query = usageSummaryQuerySchema.safeParse(Object.fromEntries(search));
    if (!query.success) return validationProblem(query.error, instance, requestId);
    const summary = await getUsageSummary(
      principal.user.id,
      query.data.workspaceId,
      parseUsageRange(query.data.from, query.data.to),
      query.data.groupBy
    );
    return Response.json(
      { data: summary, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return usageErrorResponse(error, instance, requestId);
  }
}
