import type { Metadata } from "next";

import { AuthCard } from "@/modules/auth/components/auth-card";
import { ResetPasswordForm } from "@/modules/auth/components/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

interface ResetPasswordPageProps {
  readonly searchParams: Promise<{ token?: string; error?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token, error } = await searchParams;
  return (
    <AuthCard
      eyebrow="Account recovery"
      title="Choose a new password."
      description="A successful reset revokes every existing session. You will sign in again afterward."
    >
      <ResetPasswordForm token={token} linkError={error} />
    </AuthCard>
  );
}
