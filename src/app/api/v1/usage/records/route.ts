import { listUsageRecords } from "@/modules/usage/server/analytics";
import { usageErrorResponse } from "@/modules/usage/server/route-support";
import { parseUsageRange, usageRecordsQuerySchema } from "@/modules/usage/server/validation";
import { requireWorkspacePrincipal } from "@/modules/workspaces/server/route-support";
import { validationProblem } from "@/platform/http/problem";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/usage/records";
  try {
    const principal = await requireWorkspacePrincipal(request, instance, requestId);
    const search = new URL(request.url).searchParams;
    const query = usageRecordsQuerySchema.safeParse(Object.fromEntries(search));
    if (!query.success) return validationProblem(query.error, instance, requestId);
    const records = await listUsageRecords(principal.user.id, query.data.workspaceId, {
      ...parseUsageRange(query.data.from, query.data.to),
      provider: query.data.provider,
      model: query.data.model,
      cursor: query.data.cursor,
      limit: query.data.limit
    });
    return Response.json(
      {
        data: records.items,
        meta: { requestId, nextCursor: records.nextCursor, scope: records.scope }
      },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return usageErrorResponse(error, instance, requestId);
  }
}
