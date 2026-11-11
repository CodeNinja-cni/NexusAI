import type { Metadata } from "next";
import { connection } from "next/server";

import { AuthCard } from "@/modules/auth/components/auth-card";
import { LoginForm } from "@/modules/auth/components/login-form";
import { getSocialAuthAvailability } from "@/modules/auth/server/social-auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams
}: {
  readonly searchParams: Promise<{
    accountDeletion?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>;
}) {
  await connection();
  const parameters = await searchParams;
  const status = parameters.accountDeletion;
  const socialProviders = getSocialAuthAvailability();
  const description =
    status === "requested"
      ? "Account deletion is scheduled and every session has been revoked. Check your verified email for the single-use cancellation link."
      : status === "cancelled"
        ? "Account deletion was cancelled. Sign in again to continue, and reset your password if you did not initiate the request."
        : "Sign in with a verified email. Sessions are stored server-side and the browser receives only an HttpOnly cookie.";
  return (
    <AuthCard eyebrow="Database-backed session" title="Welcome back." description={description}>
      <LoginForm
        socialProviders={socialProviders}
        oauthError={Boolean(parameters.error || parameters.error_description)}
      />
    </AuthCard>
  );
}
