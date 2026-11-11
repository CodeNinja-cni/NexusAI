import type { Metadata } from "next";
import { connection } from "next/server";

import { AuthCard } from "@/modules/auth/components/auth-card";
import { RegisterForm } from "@/modules/auth/components/register-form";
import { getSocialAuthAvailability } from "@/modules/auth/server/social-auth";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({
  searchParams
}: {
  readonly searchParams: Promise<{
    error?: string | string[];
    error_description?: string | string[];
  }>;
}) {
  await connection();
  const parameters = await searchParams;
  const socialProviders = getSocialAuthAvailability();
  return (
    <AuthCard
      eyebrow="Secure registration"
      title="Create your account."
      description="Verification is required before sign-in. Your private workspace is provisioned only after the email is confirmed."
    >
      <RegisterForm
        socialProviders={socialProviders}
        oauthError={Boolean(parameters.error || parameters.error_description)}
      />
    </AuthCard>
  );
}
