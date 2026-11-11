import { getAdminDashboard } from "@/modules/administration/server/service";
import {
  adminHeaders,
  administrationErrorResponse,
  requireAdminPrincipal
} from "@/modules/administration/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/admin/dashboard";
  try {
    const principal = await requireAdminPrincipal(request);
    const data = await getAdminDashboard(principal.user.id, requestId);
    return Response.json({ data, meta: { requestId } }, { headers: adminHeaders(requestId) });
  } catch (error) {
    return administrationErrorResponse(error, instance, requestId);
  }
}
