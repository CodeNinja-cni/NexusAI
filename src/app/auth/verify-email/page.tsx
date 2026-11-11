import type { Metadata } from "next";

import { AuthCard } from "@/modules/auth/components/auth-card";
import { EmailActionForm } from "@/modules/auth/components/email-action-form";

export const metadata: Metadata = { title: "Verify email" };

export default function VerifyEmailPage() {
  return (
    <AuthCard
      eyebrow="Email verification"
      title="Confirm your address."
      description="Verification links expire after 24 hours. Requests always use an enumeration-safe response."
    >
      <EmailActionForm mode="VERIFY" />
    </AuthCard>
  );
}
