import type { Metadata } from "next";

import { AuthCard } from "@/modules/auth/components/auth-card";
import { TwoFactorChallenge } from "@/modules/auth/components/two-factor-challenge";

export const metadata: Metadata = { title: "Verify sign-in" };

export default async function TwoFactorPage({
  searchParams
}: {
  readonly searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const candidate = (await searchParams).returnTo;
  const returnTo =
    typeof candidate === "string" && candidate.startsWith("/admin") ? candidate : "/dashboard";
  return (
    <AuthCard
      eyebrow="Protected sign-in"
      title="Confirm it’s you."
      description="Enter the current code from your authenticator, or use one of your single-use recovery codes."
    >
      <TwoFactorChallenge returnTo={returnTo} />
    </AuthCard>
  );
}
