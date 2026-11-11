"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FormField, SelectField } from "@/components/ui/form-field";

import styles from "./settings-forms.module.css";

interface PreferencePayload {
  readonly defaultModelKey: string | null;
  readonly timeZone: string;
  readonly aiPreferences: {
    readonly responseStyle: "BALANCED" | "CONCISE" | "DETAILED";
    readonly includeSources: boolean;
    readonly explainCode: boolean;
  };
  readonly notificationPreferences: {
    readonly newActivity: boolean;
    readonly documentProcessing: boolean;
    readonly workflowStatus: boolean;
  };
  readonly etag: string;
}

export function AiPreferencesForm({
  preference,
  models
}: {
  readonly preference: PreferencePayload;
  readonly models: readonly { readonly key: string; readonly label: string }[];
}) {
  const [etag, setEtag] = useState(preference.etag);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await save({
      defaultModelKey: String(data.get("defaultModelKey") || "") || null,
      timeZone: String(data.get("timeZone") || "UTC"),
      aiPreferences: {
        responseStyle: String(
          data.get("responseStyle")
        ) as PreferencePayload["aiPreferences"]["responseStyle"],
        includeSources: data.get("includeSources") === "on",
        explainCode: data.get("explainCode") === "on"
      }
    });
  }

  async function save(body: object) {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch("/api/v1/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": etag },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as { data?: PreferencePayload; detail?: string };
      if (!response.ok || !payload.data)
        throw new Error(payload.detail ?? "Preferences were not saved.");
      setEtag(payload.data.etag);
      setMessage("AI preferences saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preferences were not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Feedback error={error} message={message} />
      <SelectField
        label="Default model"
        name="defaultModelKey"
        defaultValue={preference.defaultModelKey ?? models[0]?.key}
      >
        {models.map((model) => (
          <option key={model.key} value={model.key}>
            {model.label}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Response style"
        name="responseStyle"
        defaultValue={preference.aiPreferences.responseStyle}
      >
        <option value="BALANCED">Balanced</option>
        <option value="CONCISE">Concise</option>
        <option value="DETAILED">Detailed</option>
      </SelectField>
      <FormField
        label="Time zone"
        name="timeZone"
        defaultValue={preference.timeZone}
        maxLength={64}
        required
        hint="Use an IANA zone such as Africa/Lagos or Europe/London."
      />
      <label className={styles.check}>
        <input
          type="checkbox"
          name="includeSources"
          defaultChecked={preference.aiPreferences.includeSources}
        />
        <span>
          <strong>Prefer cited answers</strong>
          <small>Ask supported experiences to preserve source context.</small>
        </span>
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          name="explainCode"
          defaultChecked={preference.aiPreferences.explainCode}
        />
        <span>
          <strong>Explain generated code</strong>
          <small>Prefer a short rationale with code-oriented responses.</small>
        </span>
      </label>
      <Button type="submit" loading={pending} loadingLabel="Saving">
        Save AI preferences
      </Button>
    </form>
  );
}

export function NotificationPreferencesForm({
  preference
}: {
  readonly preference: PreferencePayload;
}) {
  const [etag, setEtag] = useState(preference.etag);
  const [values, setValues] = useState(preference.notificationPreferences);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch("/api/v1/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": etag },
        body: JSON.stringify({ notificationPreferences: values })
      });
      const payload = (await response.json()) as { data?: PreferencePayload; detail?: string };
      if (!response.ok || !payload.data)
        throw new Error(payload.detail ?? "Preferences were not saved.");
      setEtag(payload.data.etag);
      setValues(payload.data.notificationPreferences);
      setMessage("Notification preferences saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preferences were not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <Feedback error={error} message={message} />
      {(
        [
          ["newActivity", "New workspace activity", "Membership and collaboration changes."],
          [
            "documentProcessing",
            "Document processing",
            "Ready, failed, and quarantined document outcomes."
          ],
          ["workflowStatus", "Workflow status", "Controlled workflow execution outcomes."]
        ] as const
      ).map(([key, label, hint]) => (
        <label className={styles.check} key={key}>
          <input
            type="checkbox"
            checked={values[key]}
            onChange={(event) =>
              setValues((current) => ({ ...current, [key]: event.target.checked }))
            }
          />
          <span>
            <strong>{label}</strong>
            <small>{hint}</small>
          </span>
        </label>
      ))}
      <p className={styles.note}>Security and account alerts cannot be disabled.</p>
      <Button type="submit" loading={pending} loadingLabel="Saving">
        Save notification preferences
      </Button>
    </form>
  );
}

function Feedback({
  error,
  message
}: {
  readonly error?: string | undefined;
  readonly message?: string | undefined;
}) {
  return (
    <>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className={styles.status}>{message}</p> : null}
    </>
  );
}
