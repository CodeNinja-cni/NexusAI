import { getAdminUser, updateAdminUser } from "@/modules/administration/server/service";
import {
  AdministrationError,
  adminHeaders,
  administrationErrorResponse,
  parseAdminBody,
  requireAdminPrincipal,
  requireStrongEtag
} from "@/modules/administration/server/route-support";
import { adminUserUpdateSchema } from "@/modules/administration/server/validation";
import { validationProblem } from "@/platform/http/problem";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { readonly params: Promise<{ userId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const userId = (await context.params).userId;
  const instance = `/api/v1/admin/users/${encodeURIComponent(userId)}`;
  try {
    const principal = await requireAdminPrincipal(request);
    const data = await getAdminUser(principal.user.id, userId, requestId);
    return Response.json(
      { data, meta: { requestId } },
      { headers: adminHeaders(requestId, { ETag: `"${data.version}"` }) }
    );
  } catch (error) {
    return administrationErrorResponse(error, instance, requestId);
  }
}

export async function PATCH(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const userId = (await context.params).userId;
  const instance = `/api/v1/admin/users/${encodeURIComponent(userId)}`;
  try {
    const principal = await requireAdminPrincipal(request, { mutation: true });
    const expectedVersion = requireStrongEtag(request);
    const parsed = adminUserUpdateSchema.safeParse(await parseAdminBody(request));
    if (!parsed.success) return validationProblem(parsed.error, instance, requestId);
    if (parsed.data.version !== expectedVersion) {
      throw new AdministrationError(
        400,
        "version_mismatch",
        "Version mismatch",
        "The If-Match version must match the validated request body version."
      );
    }
    const data = await updateAdminUser(principal.user.id, userId, parsed.data, requestId);
    return Response.json(
      { data, meta: { requestId } },
      { headers: adminHeaders(requestId, { ETag: `"${data.version}"` }) }
    );
  } catch (error) {
    return administrationErrorResponse(error, instance, requestId);
  }
}
