"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import styles from "./administration.module.css";

interface Setting {
  readonly key: string;
  readonly value: unknown;
  readonly description: string;
  readonly version: number;
  readonly updatedAt: string;
}

export function PlatformSettingForms({ settings }: { readonly settings: readonly Setting[] }) {
  return (
    <div className={styles.settings}>
      {settings.map((setting) => (
        <SettingForm key={setting.key} setting={setting} />
      ))}
    </div>
  );
}

function SettingForm({ setting }: { readonly setting: Setting }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const value = setting.value as Record<string, unknown>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextValue =
      setting.key === "user_registration"
        ? { mode: data.get("mode") }
        : setting.key === "maintenance_notice"
          ? { enabled: data.get("enabled") === "on", message: data.get("message") }
          : {
              failedJobAlertThreshold: Number(data.get("failedJobAlertThreshold")),
              defaultUsageRangeDays: Number(data.get("defaultUsageRangeDays"))
            };
    setPending(true);
    setError(undefined);
    const response = await fetch(`/api/v1/admin/settings/${encodeURIComponent(setting.key)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": `"${setting.version}"` },
      body: JSON.stringify({ value: nextValue, reason: data.get("reason") })
    });
    setPending(false);
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) {
      setError(result.detail ?? "The setting could not be updated.");
      return;
    }
    setMessage("Configuration saved and audited.");
    router.refresh();
  }

  return (
    <section className={styles.setting}>
      <div>
        <span className={styles.eyebrow}>Version {setting.version}</span>
        <h2>{title(setting.key)}</h2>
        <p>{setting.description}</p>
        <small className={styles.muted}>
          Updated {new Date(setting.updatedAt).toLocaleString()}
        </small>
      </div>
      <form className={styles.form} onSubmit={submit}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className={styles.success} role="status">
            {message}
          </p>
        ) : null}
        {setting.key === "user_registration" ? (
          <label>
            Registration mode
            <select name="mode" defaultValue={String(value.mode)}>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>
        ) : null}
        {setting.key === "maintenance_notice" ? (
          <>
            <label>
              <input name="enabled" type="checkbox" defaultChecked={value.enabled === true} />{" "}
              Notice enabled
            </label>
            <label>
              Notice message
              <textarea name="message" maxLength={240} defaultValue={String(value.message ?? "")} />
            </label>
          </>
        ) : null}
        {setting.key === "admin_operations" ? (
          <>
            <label>
              Failed-job alert threshold
              <input
                name="failedJobAlertThreshold"
                type="number"
                min={1}
                max={1000}
                defaultValue={Number(value.failedJobAlertThreshold)}
              />
            </label>
            <label>
              Default usage range
              <select
                name="defaultUsageRangeDays"
                defaultValue={Number(value.defaultUsageRangeDays)}
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
          </>
        ) : null}
        <label>
          Audit reason
          <textarea
            name="reason"
            minLength={12}
            maxLength={500}
            required
            placeholder="Why is this platform change required?"
          />
        </label>
        <Button type="submit" loading={pending}>
          Save configuration
        </Button>
      </form>
    </section>
  );
}

function title(key: string) {
  return key
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
