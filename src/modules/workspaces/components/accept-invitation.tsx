"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, LogIn } from "lucide-react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { problemDetail } from "./workspace-list";
import styles from "./accept-invitation.module.css";

export function AcceptInvitation() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenValue = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (tokenValue) window.history.replaceState(null, "", window.location.pathname);
    queueMicrotask(() => setToken(tokenValue));
  }, []);

  async function accept() {
    if (!token) return;
    setPending(true);
    setError(null);
    const response = await fetch("/api/v1/workspace-invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    if (!response.ok) {
      const detail = await problemDetail(response);
      setError(
        response.status === 401
          ? "Sign in to the invited email account in another tab, then return here and try again."
          : detail
      );
      setPending(false);
      return;
    }
    const payload = (await response.json()) as { data: { workspace: { id: string } } };
    await fetch(`/api/v1/workspaces/${payload.data.workspace.id}/selection`, { method: "POST" });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={styles.icon}>
          <Icon icon={token ? KeyRound : CheckCircle2} />
        </span>
        <p>Workspace invitation</p>
        <h1>{token ? "Join the workspace." : "Invitation link incomplete."}</h1>
        <p className={styles.description}>
          {token
            ? "NEXUS will verify your signed-in email and the invitation policy before creating membership."
            : "Open the complete invitation link from your email. No membership change has been made."}
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          {token ? (
            <Button loading={pending} onClick={accept}>
              Accept invitation
            </Button>
          ) : null}
          <ButtonLink
            href="/auth/login"
            target="_blank"
            variant="secondary"
            leadingIcon={<Icon icon={LogIn} />}
          >
            Sign in in another tab
          </ButtonLink>
        </div>
        <small>The invitation token is removed from the address bar before it is submitted.</small>
      </section>
    </main>
  );
}
