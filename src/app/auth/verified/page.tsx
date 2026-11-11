import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/modules/auth/components/auth-card";

import styles from "@/modules/auth/components/auth-card.module.css";

export const metadata: Metadata = { title: "Email verified" };

interface VerifiedPageProps {
  readonly searchParams: Promise<{ error?: string }>;
}

export default async function VerifiedPage({ searchParams }: VerifiedPageProps) {
  const { error } = await searchParams;
  return (
    <AuthCard
      eyebrow="Verification result"
      title={error ? "That link was not accepted." : "Your email is verified."}
      description={
        error
          ? "The verification link may be invalid or expired. Request a fresh link without revealing whether an address is registered."
          : "Your private workspace has been queued for provisioning. Sign in to continue."
      }
    >
      <p className={styles.links}>
        <Link href={error ? "/auth/verify-email" : "/auth/login"}>
          {error ? "Request another link" : "Continue to sign in"}
        </Link>
      </p>
    </AuthCard>
  );
}
