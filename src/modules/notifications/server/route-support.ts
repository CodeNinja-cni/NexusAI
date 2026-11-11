import "server-only";

import type { ZodType } from "zod";

import { resolveRequestPrincipal, type RequestPrincipal } from "@/modules/auth/server/session";
import {
  MalformedJsonError,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
  isTrustedMutationRequest,
  readJsonBody
} from "@/platform/http/request";
import {
  internalProblemResponse,
  problemResponse,
  validationProblem
} from "@/platform/http/problem";

export class NotificationRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    detail: string,
    readonly headers?: HeadersInit
  ) {
    super(detail);
  }
}

export async function requireNotificationPrincipal(request: Request): Promise<RequestPrincipal> {
  const principal = await resolveRequestPrincipal(request.headers);
  if (!principal) {
    throw new NotificationRouteError(
      401,
      "unauthenticated",
      "Authentication required",
      "A valid session is required."
    );
  }
  if (!principal.user.emailVerified) {
    throw new NotificationRouteError(
      403,
      "email_unverified",
      "Email verification required",
      "Verify your email before accessing notifications."
    );
  }
  return principal;
}

export function requireNotificationMutation(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    throw new NotificationRouteError(
      403,
      "untrusted_origin",
      "Request origin rejected",
      "This state-changing request did not come from a trusted origin."
    );
  }
}

export async function parseNotificationBody<T>(
  request: Request,
  schema: ZodType<T>,
  instance: string,
  requestId: string
): Promise<T | Response> {
  try {
    const parsed = schema.safeParse(await readJsonBody(request));
    return parsed.success ? parsed.data : validationProblem(parsed.error, instance, requestId);
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) {
      return problemResponse({
        status: 415,
        code: "unsupported_media_type",
        title: "Unsupported media type",
        detail: "Use application/json.",
        instance,
        requestId
      });
    }
    if (error instanceof RequestBodyTooLargeError) {
      return problemResponse({
        status: 413,
        code: "request_too_large",
        title: "Request body too large",
        detail: "The JSON body must not exceed 256 KiB.",
        instance,
        requestId
      });
    }
    if (error instanceof MalformedJsonError) {
      return problemResponse({
        status: 400,
        code: "malformed_json",
        title: "Malformed JSON",
        detail: "The request body is not valid JSON.",
        instance,
        requestId
      });
    }
    throw error;
  }
}

export function notificationErrorResponse(error: unknown, instance: string, requestId: string) {
  if (error instanceof NotificationRouteError) {
    return problemResponse({
      status: error.status,
      code: error.code,
      title: error.title,
      detail: error.message,
      instance,
      requestId,
      ...(error.headers ? { headers: error.headers } : {})
    });
  }
  return internalProblemResponse(instance, requestId, "notification-api");
}
