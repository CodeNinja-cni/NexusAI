"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { authClient } from "@/modules/auth/client";
import { SocialAuthButtons } from "@/modules/auth/components/social-auth-buttons";
import type { SocialAuthAvailability } from "@/modules/auth/social-auth";
import { registrationSchema } from "@/shared/validation/auth";

import styles from "./auth-card.module.css";

interface RegisterFormProps {
  readonly socialProviders: SocialAuthAvailability;
  readonly oauthError?: boolean | undefined;
}

export function RegisterForm({
  socialProviders,
  oauthError = false
}: RegisterFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);

    const form = event.currentTarget;
    const formData = new FormData(form);

    const parsed = registrationSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password")
    });

    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the form and try again."
      );
      return;
    }

    setPending(true);

    try {
      const result = await authClient.signUp.email({
        ...parsed.data,
        callbackURL: "/auth/verified"
      });

      if (result.error) {
        setError(
          result.error.message ?? "Registration could not be completed."
        );
        return;
      }

      form.reset();

      setMessage(
        "Check your inbox for a verification link. The same response is shown for existing accounts."
      );
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.status}>{message}</p> : null}

      <SocialAuthButtons
        availability={socialProviders}
        mode="register"
        initialError={oauthError}
      />

      <FormField
        label="Name"
        name="name"
        autoComplete="name"
        required
        maxLength={120}
      />

      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />

      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        minLength={6}
        maxLength={128}
        required
        hint="Use at least 6 characters. A longer, unique passphrase is safer."
      />

      <Button
        type="submit"
        loading={pending}
        loadingLabel="Creating account"
        fullWidth
      >
        Create account
      </Button>

      <p className={styles.links}>
        <Link href="/auth/login">Already registered? Sign in</Link>
      </p>
    </form>
  );
}