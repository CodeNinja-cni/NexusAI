"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/modules/auth/client";
import { emailSchema } from "@/shared/validation/auth";

import styles from "./auth-card.module.css";

interface EmailActionFormProps {
  readonly mode: "VERIFY" | "RESET";
}

export function EmailActionForm({ mode }: EmailActionFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    const email = emailSchema.safeParse(new FormData(event.currentTarget).get("email"));
    if (!email.success) {
      setError(email.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }

    setPending(true);
    const result =
      mode === "VERIFY"
        ? await authClient.sendVerificationEmail({
            email: email.data,
            callbackURL: "/auth/verified"
          })
        : await authClient.requestPasswordReset({
            email: email.data,
            redirectTo: "/auth/reset-password"
          });
    setPending(false);

    if (result.error) {
      setError("The request could not be completed. Wait a moment and try again.");
      return;
    }

    setMessage(
      mode === "VERIFY"
        ? "If the address belongs to an unverified account, a new verification link is on its way."
        : "If the address belongs to an account, a password reset link is on its way."
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.status}>{message}</p> : null}
      <FormField label="Email" name="email" type="email" autoComplete="email" required />
      <Button type="submit" loading={pending} loadingLabel="Sending" fullWidth>
        {mode === "VERIFY" ? "Send verification link" : "Send reset link"}
      </Button>
      <p className={styles.links}>
        <Link href="/auth/login">Back to sign in</Link>
      </p>
    </form>
  );
}
