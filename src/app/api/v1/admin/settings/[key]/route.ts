import { updatePlatformSetting } from "@/modules/administration/server/service";
import {
  adminHeaders,
  administrationErrorResponse,
  parseAdminBody,
  requireAdminPrincipal,
  requireStrongEtag
} from "@/modules/administration/server/route-support";
import { platformSettingUpdateSchema } from "@/modules/administration/server/validation";
import { validationProblem } from "@/platform/http/problem";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ key: string }> };

export async function PATCH(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const key = (await context.params).key;
  const instance = `/api/v1/admin/settings/${encodeURIComponent(key)}`;
  try {
    const principal = await requireAdminPrincipal(request, { mutation: true });
    const version = requireStrongEtag(request);
    const parsed = platformSettingUpdateSchema.safeParse(await parseAdminBody(request));
    if (!parsed.success) return validationProblem(parsed.error, instance, requestId);
    const data = await updatePlatformSetting(
      principal.user.id,
      key,
      parsed.data.value,
      parsed.data.reason,
      version,
      requestId
    );
    return Response.json(
      { data, meta: { requestId } },
      { headers: adminHeaders(requestId, { ETag: `"${data.version}"` }) }
    );
  } catch (error) {
    return administrationErrorResponse(error, instance, requestId);
  }
}
