import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/modules/auth/server/auth";
import { resolveRequestPrincipal } from "@/modules/auth/server/session";
import { problemResponse } from "@/platform/http/problem";
import { getRequestId } from "@/platform/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = toNextJsHandler(auth);

export const GET = handler.GET;

export async function POST(request: Request) {
  if (new URL(request.url).pathname.endsWith("/two-factor/disable")) {
    const principal = await resolveRequestPrincipal(request.headers);
    if (principal?.user.platformRole === "ADMIN") {
      const requestId = getRequestId(request);
      return problemResponse({
        status: 403,
        code: "admin_mfa_required",
        title: "Administrator MFA is mandatory",
        detail: "Platform administrators cannot disable multi-factor authentication.",
        instance: "/api/auth/two-factor/disable",
        requestId
      });
    }
  }
  return handler.POST(request);
}
