import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/workspace/invitations/accept") {
    return NextResponse.next();
  }
  const sessionCookie = getSessionCookie(request, { cookiePrefix: "nexus" });
  if (!sessionCookie) {
    const loginUrl = new URL("/auth/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/chat/:path*",
    "/dashboard/:path*",
    "/documents/:path*",
    "/notifications/:path*",
    "/settings/:path*",
    "/usage/:path*",
    "/workspace/:path*"
  ]
};
