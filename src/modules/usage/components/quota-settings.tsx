"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";

import styles from "./quota-settings.module.css";

interface QuotaLimits {
  readonly requests: string | null;
  readonly inputTokens: string | null;
  readonly outputTokens: string | null;
  readonly estimatedCostMicros: string | null;
}

interface QuotaSettingsProps {
  readonly workspaceId: string;
  readonly policyVersion: number;
  readonly limits: QuotaLimits;
  readonly canManage: boolean;
}

export function QuotaSettings({
  workspaceId,
  policyVersion,
  limits,
  canManage
}: QuotaSettingsProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/v1/usage/quota?workspaceId=${workspaceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"usage-policy:${workspaceId}:${policyVersion}"`
        },
        body: JSON.stringify({
          requestLimit: integerOrNull(form.get("requestLimit")),
          inputTokenLimit: integerOrNull(form.get("inputTokenLimit")),
          outputTokenLimit: integerOrNull(form.get("outputTokenLimit")),
          costLimitMicros: dollarsToMicrosOrNull(form.get("costLimit"))
        })
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(problem?.detail || "The quota policy could not be saved.");
      }
      setMessage("Quota policy saved and applied to the current UTC month.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The quota policy could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <p className={styles.readOnly}>
        Workspace members can review limits. Only Owners and Admins can change them.
      </p>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.fields}>
        <FormField
          label="AI requests"
          name="requestLimit"
          inputMode="numeric"
          pattern="[0-9]*"
          defaultValue={limits.requests ?? ""}
          placeholder="Unlimited"
          hint="Maximum provider attempts per UTC month."
          optional
        />
        <FormField
          label="Input tokens"
          name="inputTokenLimit"
          inputMode="numeric"
          pattern="[0-9]*"
          defaultValue={limits.inputTokens ?? ""}
          placeholder="Unlimited"
          hint="Capacity is reserved before generation and reconciled afterward."
          optional
        />
        <FormField
          label="Output tokens"
          name="outputTokenLimit"
          inputMode="numeric"
          pattern="[0-9]*"
          defaultValue={limits.outputTokens ?? ""}
          placeholder="Unlimited"
          hint="A request reserves the configured per-request output ceiling."
          optional
        />
        <FormField
          label="Estimated cost limit (USD)"
          name="costLimit"
          inputMode="decimal"
          pattern="[0-9]+([.][0-9]{1,6})?"
          defaultValue={microsToDollars(limits.estimatedCostMicros)}
          placeholder="Unlimited"
          hint="Requires an approved price row for every selected model."
          optional
        />
      </div>
      <div className={styles.actions}>
        <p>Leave a field blank for unlimited. Zero blocks that dimension immediately.</p>
        <Button
          type="submit"
          loading={saving}
          loadingLabel="Saving quota"
          leadingIcon={<Icon icon={Save} />}
        >
          Save quota policy
        </Button>
      </div>
      <div className={styles.feedback} aria-live="polite">
        {error ? <p role="alert">{error}</p> : null}
        {message ? <p data-success>{message}</p> : null}
      </div>
    </form>
  );
}

function integerOrNull(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (!/^\d{1,19}$/u.test(normalized)) throw new Error("Quota values must be whole numbers.");
  return normalized;
}

function dollarsToMicrosOrNull(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  const match = /^(\d{1,13})(?:\.(\d{1,6}))?$/u.exec(normalized);
  if (!match) throw new Error("The cost limit must be USD with at most six decimal places.");
  return (BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"))).toString();
}

function microsToDollars(value: string | null) {
  if (value === null) return "";
  const micros = BigInt(value);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}
