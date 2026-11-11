"use client";

import { useState, type FormEvent } from "react";

import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { profileUpdateSchema } from "@/shared/validation/auth";

import styles from "./profile-form.module.css";

interface ProfileFormProps {
  readonly name: string;
  readonly image: string | null;
  readonly initialEtag: string;
}

export function ProfileForm({ name, image, initialEtag }: ProfileFormProps) {
  const [etag, setEtag] = useState(initialEtag);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    const formData = new FormData(event.currentTarget);
    const imageValue = String(formData.get("image") ?? "").trim();
    const parsed = profileUpdateSchema.safeParse({
      name: formData.get("name"),
      image: imageValue || null
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the profile fields.");
      return;
    }

    setPending(true);
    const response = await fetch("/api/v1/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "If-Match": etag
      },
      body: JSON.stringify(parsed.data)
    });
    setPending(false);

    if (!response.ok) {
      setError(
        response.status === 412
          ? "Your profile changed in another tab. Reload before saving again."
          : "The profile could not be updated."
      );
      return;
    }

    setEtag(response.headers.get("etag") ?? etag);
    setMessage("Profile updated.");
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.status}>{message}</p> : null}
      <FormField label="Display name" name="name" defaultValue={name} maxLength={120} required />
      <FormField
        label="Profile image URL"
        name="image"
        type="url"
        defaultValue={image ?? ""}
        maxLength={2048}
        placeholder="https://…"
        hint="Leave blank to remove the current image."
      />
      <Button type="submit" loading={pending} loadingLabel="Saving">
        Save profile
      </Button>
    </form>
  );
}
