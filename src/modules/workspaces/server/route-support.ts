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

export class WorkspaceDomainError extends Error {
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

export async function requireWorkspacePrincipal(
  request: Request,
  _instance: string,
  _requestId: string
): Promise<RequestPrincipal> {
  const principal = await resolveRequestPrincipal(request.headers);
  if (!principal) {
    throw new WorkspaceDomainError(
      401,
      "unauthenticated",
      "Authentication required",
      "A valid session is required."
    );
  }
  if (!principal.user.emailVerified) {
    throw new WorkspaceDomainError(
      403,
      "email_unverified",
      "Email verification required",
      "Verify your email before accessing product resources."
    );
  }
  if (principal.provisioning?.status !== "READY") {
    throw new WorkspaceDomainError(
      503,
      "account_provisioning",
      "Account setup in progress",
      "Your private workspace is still being prepared.",
      { "Retry-After": "5" }
    );
  }
  return principal;
}

export function requireTrustedMutation(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    throw new WorkspaceDomainError(
      403,
      "untrusted_origin",
      "Request origin rejected",
      "This state-changing request did not come from a trusted origin."
    );
  }
}

export function requireFreshSession(principal: RequestPrincipal) {
  const createdAt = new Date(principal.session.createdAt).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > 10 * 60 * 1000) {
    throw new WorkspaceDomainError(
      403,
      "fresh_authentication_required",
      "Recent authentication required",
      "Sign in again before performing this sensitive operation."
    );
  }
}

export async function parseWorkspaceBody<T>(
  request: Request,
  schema: ZodType<T>,
  instance: string,
  requestId: string,
  maximumBytes = 256 * 1024
): Promise<T | Response> {
  try {
    const result = schema.safeParse(await readJsonBody(request, maximumBytes));
    return result.success ? result.data : validationProblem(result.error, instance, requestId);
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
        detail: `The JSON body must not exceed ${Math.floor(error.maximumBytes / 1024)} KiB.`,
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

export function workspaceErrorResponse(
  error: unknown,
  instance: string,
  requestId: string
): Response {
  if (error instanceof WorkspaceDomainError) {
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
  return internalProblemResponse(instance, requestId, "workspace-api");
}

export function requireIfMatch(request: Request, etag: string) {
  const supplied = request.headers.get("if-match");
  if (!supplied) {
    throw new WorkspaceDomainError(
      428,
      "precondition_required",
      "Precondition required",
      "Provide the current resource ETag in If-Match."
    );
  }
  if (supplied !== etag) {
    throw new WorkspaceDomainError(
      412,
      "stale_version",
      "Resource changed",
      "Reload this resource before applying the change.",
      { ETag: etag }
    );
  }
}

export const workspaceEtag = (id: string, version: number) => `"workspace:${id}:${version}"`;
export const memberEtag = (id: string, version: number) => `"workspace-member:${id}:${version}"`;
export const invitationEtag = (id: string, version: number) =>
  `"workspace-invitation:${id}:${version}"`;
