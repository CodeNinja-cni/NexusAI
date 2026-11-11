import { revokeAdminUserSessions } from "@/modules/administration/server/service";
import {
  adminHeaders,
  administrationErrorResponse,
  parseAdminBody,
  requireAdminPrincipal
} from "@/modules/administration/server/route-support";
import { adminSessionRevocationSchema } from "@/modules/administration/server/validation";
import { validationProblem } from "@/platform/http/problem";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ userId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const userId = (await context.params).userId;
  const instance = `/api/v1/admin/users/${encodeURIComponent(userId)}/session-revocations`;
  try {
    const principal = await requireAdminPrincipal(request, { mutation: true });
    const parsed = adminSessionRevocationSchema.safeParse(await parseAdminBody(request));
    if (!parsed.success) return validationProblem(parsed.error, instance, requestId);
    const data = await revokeAdminUserSessions(
      principal.user.id,
      userId,
      parsed.data.sessionIds,
      parsed.data.reason,
      requestId
    );
    return Response.json({ data, meta: { requestId } }, { headers: adminHeaders(requestId) });
  } catch (error) {
    return administrationErrorResponse(error, instance, requestId);
  }
}
