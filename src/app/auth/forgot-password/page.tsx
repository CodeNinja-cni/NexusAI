import type { Metadata } from "next";

import { AuthCard } from "@/modules/auth/components/auth-card";
import { EmailActionForm } from "@/modules/auth/components/email-action-form";

export const metadata: Metadata = { title: "Recover password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      eyebrow="Account recovery"
      title="Reset your password."
      description="If the address is registered, a single-use link valid for 30 minutes will be sent."
    >
      <EmailActionForm mode="RESET" />
    </AuthCard>
  );
}
