"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { authClient } from "@/modules/auth/client";

import styles from "@/modules/settings/components/settings-forms.module.css";

interface Props {
  readonly enabled: boolean;
  readonly administrator: boolean;
}

export function TwoFactorSettings({ enabled: initiallyEnabled, administrator }: Props) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [totpUri, setTotpUri] = useState<string>();
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await authClient.twoFactor.enable({ password, method: "totp" });
    setPending(false);
    if (result.error || !result.data || !("totpURI" in result.data)) {
      setError("The password was not accepted or enrollment could not start.");
      return;
    }
    setTotpUri(result.data.totpURI);
    setBackupCodes(result.data.backupCodes);
    setMessage("Add the setup URI to your authenticator, then verify the current code.");
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    setPending(false);
    if (result.error) {
      setError("That authenticator code was not accepted.");
      return;
    }
    setEnabled(true);
    setTotpUri(undefined);
    setMessage("Multi-factor authentication is enabled. Store the recovery codes safely.");
  }

  async function rotateCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await authClient.twoFactor.generateBackupCodes({ password });
    setPending(false);
    if (result.error) {
      setError("The password was not accepted.");
      return;
    }
    setBackupCodes(result.data.backupCodes);
    setMessage("Previous recovery codes are invalid. Store this new set safely.");
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (result.error) {
      setError("Multi-factor authentication could not be disabled.");
      return;
    }
    setEnabled(false);
    setBackupCodes([]);
    setMessage("Multi-factor authentication is disabled.");
  }

  return (
    <div className={styles.form}>
      <p role="status">Status: {enabled ? "Enabled" : "Not enabled"}</p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className={styles.status}>{message}</p> : null}
      {totpUri ? (
        <>
          <p>
            <strong>Authenticator setup URI</strong>
          </p>
          <code>{totpUri}</code>
          <form className={styles.form} onSubmit={verifyEnrollment}>
            <FormField
              label="Authenticator code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
            <Button type="submit" loading={pending}>
              Verify and enable
            </Button>
          </form>
        </>
      ) : enabled ? (
        <>
          <form className={styles.form} onSubmit={rotateCodes}>
            <FormField
              label="Current password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button type="submit" variant="secondary" loading={pending}>
              Replace recovery codes
            </Button>
          </form>
          {!administrator ? (
            <form className={styles.form} onSubmit={disable}>
              <FormField
                label="Current password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
              <Button type="submit" variant="danger" loading={pending}>
                Disable MFA
              </Button>
            </form>
          ) : null}
        </>
      ) : (
        <form className={styles.form} onSubmit={beginEnrollment}>
          <FormField
            label="Current password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Button type="submit" loading={pending}>
            Set up authenticator
          </Button>
        </form>
      )}
      {backupCodes.length ? (
        <div>
          <p>
            <strong>Recovery codes — shown only now</strong>
          </p>
          <ul>
            {backupCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
