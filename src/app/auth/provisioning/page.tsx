import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard } from "@/modules/auth/components/auth-card";
import { requirePagePrincipal } from "@/modules/auth/server/session";

import styles from "@/modules/auth/components/auth-card.module.css";

export default async function ProvisioningPage() {
  const principal = await requirePagePrincipal();
  if (principal.provisioning?.status === "READY") redirect("/dashboard");

  return (
    <AuthCard
      eyebrow="Account provisioning"
      title="Preparing your private workspace."
      description="The setup operation is durable and idempotent. Product data remains blocked until the Owner membership and quota records are complete."
    >
      <p className={styles.status}>Current state: {principal.provisioning?.status ?? "PENDING"}</p>
      <p className={styles.links}>
        <Link href="/dashboard">Check again</Link>
      </p>
    </AuthCard>
  );
}
