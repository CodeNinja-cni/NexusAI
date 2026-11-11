import { listAdminActivity } from "@/modules/administration/server/service";
import {
  adminHeaders,
  administrationErrorResponse,
  requireAdminPrincipal
} from "@/modules/administration/server/route-support";
import { adminActivitySchema } from "@/modules/administration/server/validation";
import { validationProblem } from "@/platform/http/problem";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/admin/activity";
  try {
    const principal = await requireAdminPrincipal(request);
    const parsed = adminActivitySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    if (!parsed.success) return validationProblem(parsed.error, instance, requestId);
    const data = await listAdminActivity(principal.user.id, parsed.data, requestId);
    return Response.json({ data, meta: { requestId } }, { headers: adminHeaders(requestId) });
  } catch (error) {
    return administrationErrorResponse(error, instance, requestId);
  }
}
