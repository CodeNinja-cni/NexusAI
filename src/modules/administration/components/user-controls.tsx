"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import styles from "./administration.module.css";

export function UserControls({
  userId,
  role,
  status,
  version,
  self
}: {
  readonly userId: string;
  readonly role: "USER" | "ADMIN";
  readonly status: "ACTIVE" | "SUSPENDED" | "PENDING_DELETION" | "DELETED";
  readonly version: number;
  readonly self: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    setPending(true);
    setError(undefined);
    const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": `"${version}"` },
      body: JSON.stringify({
        platformRole: body.get("platformRole"),
        status: body.get("status"),
        version,
        reason: body.get("reason")
      })
    });
    setPending(false);
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) {
      setError(result.detail ?? "The account could not be updated.");
      return;
    }
    setMessage("Account access updated. Existing sessions were revoked.");
    router.refresh();
  }

  async function revoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    setPending(true);
    setError(undefined);
    const response = await fetch(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/session-revocations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      }
    );
    setPending(false);
    const result = (await response.json()) as {
      detail?: string;
      data?: { revokedSessionCount: number };
    };
    if (!response.ok) {
      setError(result.detail ?? "Sessions could not be revoked.");
      return;
    }
    setMessage(`${result.data?.revokedSessionCount ?? 0} session(s) revoked.`);
    router.refresh();
  }

  if (self)
    return (
      <p className={styles.notice}>
        Your own administrator role, status, and sessions must be managed by another active
        administrator or from Security settings.
      </p>
    );
  if (status === "PENDING_DELETION" || status === "DELETED")
    return (
      <p className={styles.notice}>
        This account is controlled by the governed deletion process and cannot be changed here.
      </p>
    );
  return (
    <div className={styles.settings}>
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
      <form className={styles.form} onSubmit={update}>
        <label>
          Platform role
          <select name="platformRole" defaultValue={role}>
            <option value="USER">User</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
        <label>
          Account status
          <select name="status" defaultValue={status}>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </label>
        <label>
          Audit reason
          <textarea
            name="reason"
            minLength={12}
            maxLength={500}
            required
            placeholder="Why is this access change necessary?"
          />
        </label>
        <Button type="submit" loading={pending}>
          Apply access change
        </Button>
      </form>
      <form className={styles.form} onSubmit={revoke}>
        <label>
          Session-revocation reason
          <textarea
            name="reason"
            minLength={12}
            maxLength={500}
            required
            placeholder="Why must every session be revoked?"
          />
        </label>
        <Button type="submit" variant="danger" loading={pending}>
          Revoke all sessions
        </Button>
      </form>
    </div>
  );
}
