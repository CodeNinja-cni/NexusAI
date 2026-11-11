"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { authClient } from "@/modules/auth/client";
import { passwordChangeSchema } from "@/modules/settings/server/validation";

import styles from "./settings-forms.module.css";

export function PasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = passwordChangeSchema.safeParse({
      currentPassword: data.get("currentPassword"),
      newPassword: data.get("newPassword"),
      confirmPassword: data.get("confirmPassword")
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the password fields.");
      return;
    }
    setPending(true);
    const result = await authClient.changePassword({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      revokeOtherSessions: true
    });
    setPending(false);
    if (result.error) {
      setError("The current password was not accepted or this session is no longer fresh.");
      return;
    }
    form.reset();
    setMessage("Password changed. Other sessions were revoked.");
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className={styles.status}>{message}</p> : null}
      <PasswordField
        label="Current password"
        name="currentPassword"
        autoComplete="current-password"
        required
      />
      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        minLength={6}
        maxLength={128}
        required
        hint="Use at least 6 characters. Longer, unique passwords are safer."
      />
      <PasswordField
        label="Confirm new password"
        name="confirmPassword"
        autoComplete="new-password"
        minLength={6}
        maxLength={128}
        required
      />
      <Button type="submit" loading={pending} loadingLabel="Changing password">
        Change password
      </Button>
    </form>
  );
}
