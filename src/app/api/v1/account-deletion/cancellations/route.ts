import { cancelAccountDeletion } from "@/modules/settings/server/account-deletion";
import { accountDeletionCancellationSchema } from "@/modules/settings/server/validation";
import {
  notificationErrorResponse,
  parseNotificationBody,
  requireNotificationMutation
} from "@/modules/notifications/server/route-support";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/account-deletion/cancellations";
  try {
    requireNotificationMutation(request);
    const body = await parseNotificationBody(
      request,
      accountDeletionCancellationSchema,
      instance,
      requestId
    );
    if (body instanceof Response) return body;
    const result = await cancelAccountDeletion(body.token, requestId);
    return Response.json(
      { data: result, meta: { requestId } },
      { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } }
    );
  } catch (error) {
    return notificationErrorResponse(error, instance, requestId);
  }
}
