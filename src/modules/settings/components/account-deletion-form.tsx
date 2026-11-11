"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { accountDeletionRequestSchema } from "@/modules/settings/server/validation";

import styles from "./settings-forms.module.css";

export function AccountDeletionForm({ blocked }: { readonly blocked: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const parsed = accountDeletionRequestSchema.safeParse({
      password: data.get("password"),
      confirmation: data.get("confirmation")
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Confirm the deletion request.");
      return;
    }
    setPending(true);
    const response = await fetch("/api/v1/me/deletion-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(parsed.data)
    });
    const payload = (await response.json()) as { detail?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.detail ?? "The deletion request could not be created.");
      return;
    }
    router.push("/auth/login?accountDeletion=requested");
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <FormField
        label="Current password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        disabled={blocked}
      />
      <FormField
        label='Type "DELETE MY ACCOUNT"'
        name="confirmation"
        autoComplete="off"
        required
        disabled={blocked}
      />
      <Button
        type="submit"
        variant="danger"
        loading={pending}
        loadingLabel="Scheduling deletion"
        disabled={blocked}
      >
        Request account deletion
      </Button>
    </form>
  );
}
