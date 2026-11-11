import "server-only";

import { cache } from "react";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";

import { auth, type AuthSession } from "@/modules/auth/server/auth";
import { prisma } from "@/platform/database/prisma";

export interface RequestPrincipal {
  readonly session: AuthSession["session"];
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly image: string | null;
    readonly emailVerified: boolean;
    readonly platformRole: "USER" | "ADMIN";
    readonly status: "ACTIVE" | "SUSPENDED" | "PENDING_DELETION" | "DELETED";
    readonly version: number;
    readonly twoFactorEnabled: boolean;
  };
  readonly provisioning: {
    readonly status: "PENDING" | "RUNNING" | "READY" | "FAILED";
    readonly personalWorkspaceId: string | null;
  } | null;
}

export async function resolveRequestPrincipal(
  requestHeaders: Headers
): Promise<RequestPrincipal | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      emailVerified: true,
      platformRole: true,
      status: true,
      deletedAt: true,
      version: true,
      twoFactorEnabled: true,
      provisioning: {
        select: { status: true, personalWorkspaceId: true }
      }
    }
  });

  if (!user || user.deletedAt || user.status !== "ACTIVE") return null;

  return {
    session: session.session,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
      platformRole: user.platformRole,
      status: user.status,
      version: user.version,
      twoFactorEnabled: user.twoFactorEnabled
    },
    provisioning: user.provisioning
  };
}

export async function requireAdminPagePrincipal(): Promise<RequestPrincipal> {
  const principal = await requirePagePrincipal();
  if (principal.user.platformRole !== "ADMIN") notFound();
  const session = await prisma.session.findUnique({
    where: { id: principal.session.id },
    select: { mfaVerifiedAt: true }
  });
  if (!principal.user.twoFactorEnabled || !session?.mfaVerifiedAt) {
    redirect("/settings/security?mfa=required");
  }
  return principal;
}

export const getPagePrincipal = cache(async () => resolveRequestPrincipal(await headers()));

export async function requirePagePrincipal(): Promise<RequestPrincipal> {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/auth/login");
  if (!principal.user.emailVerified) redirect("/auth/verify-email");
  return principal;
}

export async function requireReadyPagePrincipal(): Promise<RequestPrincipal> {
  const principal = await requirePagePrincipal();
  if (principal.provisioning?.status !== "READY") redirect("/auth/provisioning");
  return principal;
}
