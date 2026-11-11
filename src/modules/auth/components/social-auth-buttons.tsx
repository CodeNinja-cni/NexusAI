"use client";

import { useState } from "react";

import { authClient } from "@/modules/auth/client";
import type { SocialAuthAvailability, SocialAuthMode } from "@/modules/auth/social-auth";

import styles from "./social-auth-buttons.module.css";

interface SocialAuthButtonsProps {
  readonly availability: SocialAuthAvailability;
  readonly mode: SocialAuthMode;
  readonly initialError?: boolean | undefined;
}

type SocialProvider = keyof SocialAuthAvailability;

const providers = [
  { id: "google", label: "Google" },
  { id: "apple", label: "Apple" }
] as const;

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="#4285f4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.4Z"
      />
      <path
        fill="#34a853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.52c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#fbbc05"
        d="M6.39 13.88A6 6 0 0 1 6.08 12c0-.65.11-1.29.31-1.88v-2.6H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.48l3.35-2.6Z"
      />
      <path
        fill="#ea4335"
        d="M12 5.99c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.6C7.18 7.75 9.39 5.99 12 5.99Z"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.7 12.86c.02 2.25 1.97 3 1.99 3.01-.02.06-.31 1.07-1.03 2.12-.62.9-1.27 1.8-2.29 1.82-.99.02-1.32-.59-2.46-.59-1.13 0-1.5.57-2.44.61-.97.04-1.71-.97-2.34-1.86-1.27-1.84-2.25-5.2-.94-7.48a3.64 3.64 0 0 1 3.1-1.88c.97-.02 1.88.65 2.46.65.57 0 1.66-.8 2.79-.68.48.02 1.82.19 2.68 1.45-.07.04-1.6.93-1.58 2.83ZM14.8 7.39c.52-.63.88-1.51.78-2.39-.76.03-1.67.5-2.21 1.13-.49.56-.91 1.45-.8 2.31.84.07 1.7-.43 2.23-1.05Z"
      />
    </svg>
  );
}

export function SocialAuthButtons({
  availability,
  mode,
  initialError = false
}: SocialAuthButtonsProps) {
  const [pendingProvider, setPendingProvider] = useState<SocialProvider>();
  const [error, setError] = useState(
    initialError ? "The social sign-in could not be completed. Please try again." : undefined
  );
  const anyAvailable = availability.google || availability.apple;

  async function continueWith(provider: SocialProvider) {
    if (!availability[provider]) return;
    setError(undefined);
    setPendingProvider(provider);

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/dashboard",
        newUserCallbackURL: "/dashboard",
        errorCallbackURL: mode === "register" ? "/auth/register" : "/auth/login",
        requestSignUp: mode === "register"
      });
      if (result.error) {
        setError(`Continue with ${provider === "google" ? "Google" : "Apple"} failed. Try again.`);
        setPendingProvider(undefined);
      }
    } catch {
      setError("The identity provider could not be reached. Please try again.");
      setPendingProvider(undefined);
    }
  }

  return (
    <div className={styles.group}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.providerGrid} aria-label="Social account options">
        {providers.map((provider) => {
          const enabled = availability[provider.id];
          const loading = pendingProvider === provider.id;
          return (
            <button
              key={provider.id}
              className={styles.providerButton}
              type="button"
              disabled={!enabled || pendingProvider !== undefined}
              aria-busy={loading || undefined}
              title={enabled ? undefined : `${provider.label} sign-in is not configured yet`}
              onClick={() => void continueWith(provider.id)}
            >
              <span className={styles.providerIcon}>
                {provider.id === "google" ? <GoogleMark /> : <AppleMark />}
              </span>
              <span>
                {loading ? `Connecting to ${provider.label}` : `Continue with ${provider.label}`}
              </span>
            </button>
          );
        })}
      </div>
      {!anyAvailable ? (
        <p className={styles.providerNote}>
          Social sign-in becomes available after provider credentials are configured.
        </p>
      ) : null}
      <div className={styles.divider} aria-hidden="true">
        <span>or continue with email</span>
      </div>
    </div>
  );
}
