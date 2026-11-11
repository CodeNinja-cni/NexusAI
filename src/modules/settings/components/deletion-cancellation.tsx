"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import styles from "./settings-forms.module.css";

export function DeletionCancellation({ token }: { readonly token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function cancel() {
    setPending(true);
    setError(undefined);
    const response = await fetch("/api/v1/account-deletion/cancellations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const payload = (await response.json()) as { detail?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.detail ?? "Deletion could not be cancelled.");
      return;
    }
    router.push("/auth/login?accountDeletion=cancelled");
    router.refresh();
  }

  return (
    <div className={styles.form}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <Button onClick={() => void cancel()} loading={pending} loadingLabel="Cancelling deletion">
        Cancel account deletion
      </Button>
    </div>
  );
}
