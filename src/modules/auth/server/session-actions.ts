"use server";

import { z } from "zod";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { auth } from "@/modules/auth/server/auth";
import { resolveRequestPrincipal } from "@/modules/auth/server/session";
import { prisma } from "@/platform/database/prisma";

const sessionIdSchema = z.string().min(1).max(128);

export async function revokeSessionAction(formData: FormData) {
  const parsedSessionId = sessionIdSchema.safeParse(formData.get("sessionId"));
  if (!parsedSessionId.success) return;

  const requestHeaders = await headers();
  const principal = await resolveRequestPrincipal(requestHeaders);
  if (!principal) redirect("/auth/login");

  const session = await prisma.session.findFirst({
    where: { id: parsedSessionId.data, userId: principal.user.id },
    select: { id: true, token: true }
  });
  if (!session) return;

  await auth.api.revokeSession({
    headers: requestHeaders,
    body: { token: session.token }
  });

  if (session.id === principal.session.id) redirect("/auth/login");
  revalidatePath("/settings/security");
}

export async function revokeOtherSessionsAction() {
  const requestHeaders = await headers();
  const principal = await resolveRequestPrincipal(requestHeaders);
  if (!principal) redirect("/auth/login");

  await auth.api.revokeOtherSessions({ headers: requestHeaders });
  revalidatePath("/settings/security");
}
