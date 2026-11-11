import "server-only";

import { randomUUID } from "node:crypto";

import { getServerEnvironment } from "@/platform/env/server";

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_JSON_BODY_BYTES = 256 * 1024;

export function getRequestId(request: Request): string {
  const suppliedId = request.headers.get("x-request-id")?.trim();

  if (suppliedId && suppliedId.length <= MAX_REQUEST_ID_LENGTH && /^[\w.-]+$/.test(suppliedId)) {
    return suppliedId;
  }

  return randomUUID();
}

export function isTrustedMutationRequest(request: Request): boolean {
  const environment = getServerEnvironment();
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin) {
    return fetchSite === "same-origin";
  }

  try {
    return environment.trustedOrigins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

export async function readJsonBody(
  request: Request,
  maximumBytes = MAX_JSON_BODY_BYTES
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new UnsupportedMediaTypeError();
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximumBytes) {
    throw new RequestBodyTooLargeError(maximumBytes);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new RequestBodyTooLargeError(maximumBytes);
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new MalformedJsonError();
  }
}

export class UnsupportedMediaTypeError extends Error {}
export class RequestBodyTooLargeError extends Error {
  constructor(readonly maximumBytes: number) {
    super("request_body_too_large");
  }
}
export class MalformedJsonError extends Error {}
