"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { authClient } from "@/modules/auth/client";
import { SocialAuthButtons } from "@/modules/auth/components/social-auth-buttons";
import type { SocialAuthAvailability } from "@/modules/auth/social-auth";
import { loginSchema } from "@/shared/validation/auth";

import styles from "./auth-card.module.css";

interface LoginFormProps {
  readonly socialProviders: SocialAuthAvailability;
  readonly oauthError?: boolean | undefined;
}

export function LoginForm({ socialProviders, oauthError = false }: LoginFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password")
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    setPending(true);
    const result = await authClient.signIn.email({
      ...parsed.data,
      rememberMe: false,
      callbackURL: "/dashboard"
    });
    setPending(false);

    if (result.error) {
      setError(
        result.error.status === 403
          ? "Verify your email before signing in."
          : "The email or password was not accepted."
      );
      return;
    }

    if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error ? <p className={styles.error}>{error}</p> : null}
      <SocialAuthButtons availability={socialProviders} mode="login" initialError={oauthError} />
      <FormField label="Email" name="email" type="email" autoComplete="email" required />
      <PasswordField label="Password" name="password" autoComplete="current-password" required />
      <Button type="submit" loading={pending} loadingLabel="Signing in" fullWidth>
        Sign in
      </Button>
      <p className={styles.links}>
        <Link href="/auth/register">Create account</Link>
        <Link href="/auth/forgot-password">Forgot password?</Link>
      </p>
    </form>
  );
}
