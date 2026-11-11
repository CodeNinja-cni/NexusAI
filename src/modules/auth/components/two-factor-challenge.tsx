"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { authClient } from "@/modules/auth/client";

import styles from "./auth-card.module.css";

export function TwoFactorChallenge({ returnTo = "/dashboard" }: { readonly returnTo?: string }) {
  const router = useRouter();
  const [recovery, setRecovery] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const result = recovery
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice: false })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    setPending(false);
    if (result.error) {
      setError(
        recovery
          ? "That recovery code was not accepted."
          : "That authenticator code was not accepted."
      );
      return;
    }
    router.replace(returnTo as Route);
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
        label={recovery ? "Recovery code" : "Authenticator code"}
        name="code"
        autoComplete="one-time-code"
        inputMode={recovery ? undefined : "numeric"}
        required
      />
      <Button type="submit" loading={pending} fullWidth>
        Verify
      </Button>
      <Button
        type="button"
        variant="secondary"
        fullWidth
        onClick={() => {
          setRecovery((value) => !value);
          setError(undefined);
        }}
      >
        {recovery ? "Use authenticator code" : "Use a recovery code"}
      </Button>
    </form>
  );
}
