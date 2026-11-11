"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { authClient } from "@/modules/auth/client";
import { passwordSchema } from "@/shared/validation/auth";

import styles from "./auth-card.module.css";

interface ResetPasswordFormProps {
  readonly token?: string | undefined;
  readonly linkError?: string | undefined;
}

export function ResetPasswordForm({ token, linkError }: ResetPasswordFormProps) {
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | undefined>(
    linkError || !token ? "This reset link is invalid or expired. Request a new one." : undefined
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(undefined);
    const newPassword = passwordSchema.safeParse(new FormData(event.currentTarget).get("password"));
    if (!newPassword.success) {
      setError(newPassword.error.issues[0]?.message ?? "Choose a different password.");
      return;
    }

    setPending(true);
    const result = await authClient.resetPassword({ newPassword: newPassword.data, token });
    setPending(false);
    if (result.error) {
      setError("The reset link was not accepted. Request a new link and try again.");
      return;
    }
    setComplete(true);
  }

  if (complete) {
    return (
      <div className={styles.form}>
        <p className={styles.status}>
          Your password was changed and all existing sessions were revoked.
        </p>
        <p className={styles.links}>
          <Link href="/auth/login">Sign in with the new password</Link>
        </p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error ? <p className={styles.error}>{error}</p> : null}
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        minLength={6}
        maxLength={128}
        required
        disabled={!token}
        hint="Use at least 6 characters and do not reuse a password from another service."
      />
      <Button type="submit" loading={pending} loadingLabel="Resetting" disabled={!token} fullWidth>
        Reset password
      </Button>
      <p className={styles.links}>
        <Link href="/auth/forgot-password">Request a new link</Link>
      </p>
    </form>
  );
}
