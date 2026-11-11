import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import type { RequestPrincipal } from "@/modules/auth/server/session";
import { resolveRequestPrincipal } from "@/modules/auth/server/session";
import { prisma } from "@/platform/database/prisma";
import { problemResponse } from "@/platform/http/problem";
import { logger } from "@/platform/observability/logger";
import {
  isTrustedMutationRequest,
  MalformedJsonError,
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError
} from "@/platform/http/request";

import { AdminRangeError } from "./validation";

const FRESH_MFA_MS = 10 * 60 * 1000;

export class AdministrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    message: string,
    readonly headers?: HeadersInit
  ) {
    super(message);
  }
}

export async function requireAdminPrincipal(
  request: Request,
  options: { readonly mutation?: boolean } = {}
): Promise<RequestPrincipal> {
  const principal = await resolveRequestPrincipal(request.headers);
  if (!principal) {
    throw new AdministrationError(
      401,
      "authentication_required",
      "Authentication required",
      "Sign in to continue."
    );
  }
  if (principal.user.platformRole !== "ADMIN") {
    await recordDeniedAccess(principal.user.id, "PLATFORM_ROLE_REQUIRED", request);
    throw new AdministrationError(
      403,
      "admin_access_denied",
      "Administrative access denied",
      "This account is not authorized for platform administration."
    );
  }
  const session = await prisma.session.findUnique({
    where: { id: principal.session.id },
    select: {
      userId: true,
      mfaVerifiedAt: true,
      expiresAt: true,
      user: { select: { twoFactor: { select: { verified: true } } } }
    }
  });
  if (
    !principal.user.twoFactorEnabled ||
    !session?.user.twoFactor?.verified ||
    !session?.mfaVerifiedAt ||
    session.userId !== principal.user.id ||
    session.expiresAt <= new Date()
  ) {
    await recordDeniedAccess(principal.user.id, "MFA_ASSURANCE_REQUIRED", request);
    throw new AdministrationError(
      403,
      "admin_mfa_required",
      "Multi-factor verification required",
      "Verify this administrator session with an authenticator or recovery code."
    );
  }
  if (options.mutation) {
    if (!isTrustedMutationRequest(request)) {
      await recordDeniedAccess(principal.user.id, "TRUSTED_ORIGIN_REQUIRED", request);
      throw new AdministrationError(
        403,
        "untrusted_origin",
        "Request origin rejected",
        "Administrative mutations must originate from NEXUS AI."
      );
    }
    if (session.mfaVerifiedAt.getTime() < Date.now() - FRESH_MFA_MS) {
      await recordDeniedAccess(principal.user.id, "FRESH_MFA_REQUIRED", request);
      throw new AdministrationError(
        403,
        "fresh_mfa_required",
        "Fresh verification required",
        "Verify your second factor again before changing platform state."
      );
    }
  }
  await enforceAdminRateLimit(principal.user.id, options.mutation ? "mutation" : "read");
  return principal;
}

async function recordDeniedAccess(userId: string, reason: string, request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      actorKind: "USER",
      action: "admin.access.denied",
      targetType: "administration",
      outcome: "DENIED",
      requestId: supplied && supplied.length <= 128 ? supplied : randomUUID(),
      metadata: { reason }
    }
  });
}

async function enforceAdminRateLimit(userId: string, mode: "read" | "mutation") {
  const limit = mode === "read" ? 120 : 30;
  const now = new Date();
  const windowStartedAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const key = `${userId}:${mode}`;
  const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO "admin_rate_limit_buckets" ("key", "window_started_at", "count", "updated_at")
    VALUES (${key}, ${windowStartedAt}, 1, ${now})
    ON CONFLICT ("key", "window_started_at") DO UPDATE
      SET "count" = "admin_rate_limit_buckets"."count" + 1,
          "updated_at" = EXCLUDED."updated_at"
    RETURNING "count"
  `);
  const retentionBoundary = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1_000);
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "admin_rate_limit_buckets"
    WHERE "window_started_at" < ${retentionBoundary}
  `);
  if ((rows[0]?.count ?? limit + 1) > limit) {
    throw new AdministrationError(
      429,
      "rate_limited",
      "Administrative rate limit reached",
      "Wait before making more administrative requests.",
      { "Retry-After": "60" }
    );
  }
}

export async function parseAdminBody(request: Request) {
  try {
    return await readJsonBody(request, 64 * 1024);
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError)
      throw new AdministrationError(
        415,
        "unsupported_media_type",
        "Unsupported media type",
        "Send an application/json request body."
      );
    if (error instanceof RequestBodyTooLargeError)
      throw new AdministrationError(
        413,
        "request_body_too_large",
        "Request body too large",
        "The administrative request body is too large."
      );
    if (error instanceof MalformedJsonError)
      throw new AdministrationError(
        400,
        "malformed_json",
        "Malformed JSON",
        "The request body is not valid JSON."
      );
    throw error;
  }
}

export function administrationErrorResponse(error: unknown, instance: string, requestId: string) {
  if (error instanceof AdministrationError) {
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
  if (error instanceof AdminRangeError) {
    return problemResponse({
      status: 422,
      code: "invalid_range",
      title: "Invalid reporting range",
      detail: "Choose a positive reporting range of no more than 366 days.",
      instance,
      requestId
    });
  }
  logger.error("admin.request.failed", { requestId });
  return problemResponse({
    status: 500,
    code: "internal_error",
    title: "Administrative request failed",
    detail: "The request could not be completed safely.",
    instance,
    requestId
  });
}

export function adminHeaders(requestId: string, additional: HeadersInit = {}) {
  return {
    "Cache-Control": "private, no-store",
    "X-Request-Id": requestId,
    ...Object.fromEntries(new Headers(additional))
  };
}

export function requireStrongEtag(request: Request) {
  const value = request.headers.get("if-match");
  const match = value?.match(/^"(\d+)"$/u);
  if (!match)
    throw new AdministrationError(
      428,
      "precondition_required",
      "If-Match required",
      "Provide the current strong ETag before changing this resource."
    );
  return Number(match[1]);
}
