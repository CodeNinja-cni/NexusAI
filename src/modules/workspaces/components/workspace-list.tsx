"use client";

import { useState, type FormEvent } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Check, Plus, RefreshCcw, Shield, Trash2, User } from "lucide-react";

import { Button, ButtonLink } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import styles from "./workspace-management.module.css";

export interface WorkspaceListItem {
  readonly id: string;
  readonly kind: "PERSONAL" | "TEAM";
  readonly name: string;
  readonly slug: string | null;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
  readonly status: "ACTIVE" | "PENDING_DELETION";
  readonly memberCount: number;
  readonly version: number;
  readonly selected: boolean;
  readonly createdAt: Date;
  readonly purgeAfter: Date | null;
}

interface WorkspaceListProps {
  readonly initialWorkspaces: readonly WorkspaceListItem[];
}

export function WorkspaceList({ initialWorkspaces }: WorkspaceListProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("create");
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), slug: form.get("slug") || undefined })
    });
    if (!response.ok) {
      setError(await problemDetail(response));
      setPending(null);
      return;
    }
    const payload = (await response.json()) as { data: { id: string } };
    router.push(`/workspace/${payload.data.id}`);
    router.refresh();
  }

  async function selectWorkspace(workspaceId: string) {
    setPending(`select:${workspaceId}`);
    setError(null);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/selection`, { method: "POST" });
    if (!response.ok) setError(await problemDetail(response));
    else {
      router.push("/dashboard");
      router.refresh();
    }
    setPending(null);
  }

  async function restoreWorkspace(workspaceId: string) {
    setPending(`restore:${workspaceId}`);
    setError(null);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/restoration`, {
      method: "POST"
    });
    if (!response.ok) setError(await problemDetail(response));
    else router.refresh();
    setPending(null);
  }

  return (
    <div className={styles.listLayout}>
      <section className={styles.workspaceGrid} aria-labelledby="workspace-list-title">
        <div className={styles.sectionHeading}>
          <div>
            <span>Membership directory</span>
            <h2 id="workspace-list-title">Your workspaces</h2>
          </div>
          <small>{initialWorkspaces.length} total</small>
        </div>
        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.cards}>
          {initialWorkspaces.map((workspace) => (
            <article className={styles.workspaceCard} key={workspace.id}>
              <div className={styles.cardTopline}>
                <span
                  className={styles.workspaceGlyph}
                  data-kind={workspace.kind}
                  aria-hidden="true"
                >
                  <Icon icon={workspace.kind === "PERSONAL" ? User : Building2} />
                </span>
                <div className={styles.pills}>
                  {workspace.selected && workspace.status === "ACTIVE" ? (
                    <StatusPill tone="success">Active</StatusPill>
                  ) : null}
                  {workspace.status === "PENDING_DELETION" ? (
                    <StatusPill tone="warning">Recovery window</StatusPill>
                  ) : null}
                </div>
              </div>
              <div className={styles.cardIdentity}>
                <p>{workspace.kind === "TEAM" ? "Team workspace" : "Private workspace"}</p>
                <h3>{workspace.name}</h3>
                <span>{workspace.slug ? `/${workspace.slug}` : "No public slug"}</span>
              </div>
              <dl className={styles.compactFacts}>
                <div>
                  <dt>Role</dt>
                  <dd>{titleCase(workspace.role)}</dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>{workspace.memberCount}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(workspace.createdAt)}</dd>
                </div>
              </dl>
              <div className={styles.cardActions}>
                {workspace.status === "ACTIVE" ? (
                  <>
                    <Button
                      variant={workspace.selected ? "ghost" : "secondary"}
                      size="small"
                      loading={pending === `select:${workspace.id}`}
                      disabled={workspace.selected}
                      leadingIcon={<Icon icon={workspace.selected ? Check : RefreshCcw} />}
                      onClick={() => selectWorkspace(workspace.id)}
                    >
                      {workspace.selected ? "Selected" : "Switch here"}
                    </Button>
                    <ButtonLink
                      href={`/workspace/${workspace.id}` as Route}
                      variant="ghost"
                      size="small"
                      trailingIcon={<Icon icon={ArrowRight} />}
                    >
                      Manage
                    </ButtonLink>
                  </>
                ) : workspace.role === "OWNER" ? (
                  <Button
                    variant="secondary"
                    size="small"
                    loading={pending === `restore:${workspace.id}`}
                    leadingIcon={<Icon icon={RefreshCcw} />}
                    onClick={() => restoreWorkspace(workspace.id)}
                  >
                    Restore workspace
                  </Button>
                ) : null}
              </div>
              {workspace.purgeAfter ? (
                <p className={styles.retentionNote}>
                  <Icon icon={Trash2} /> Recover before {formatDate(workspace.purgeAfter)}.
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <aside className={styles.createPanel} aria-labelledby="create-workspace-title">
        <div className={styles.panelIcon}>
          <Icon icon={Plus} />
        </div>
        <span>New collaboration boundary</span>
        <h2 id="create-workspace-title">Create a team workspace</h2>
        <p>
          Start private by default. You become the sole Owner and can invite collaborators after
          creation.
        </p>
        <form onSubmit={createWorkspace} className={styles.stackForm}>
          <FormField label="Workspace name" name="name" minLength={2} maxLength={120} required />
          <FormField
            label="Workspace slug"
            name="slug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            minLength={3}
            maxLength={120}
            hint="Optional. Lowercase letters, numbers, and hyphens."
            optional
          />
          <Button
            type="submit"
            fullWidth
            loading={pending === "create"}
            leadingIcon={<Icon icon={Plus} />}
          >
            Create team workspace
          </Button>
        </form>
        <div className={styles.securityNote}>
          <Icon icon={Shield} />
          <p>
            <strong>Server-enforced boundary</strong>
            <span>Membership is checked again on every request.</span>
          </p>
        </div>
      </aside>
    </div>
  );
}

export async function problemDetail(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(
      /(^|_)(\w)/gu,
      (_, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`
    );
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value)
  );
}
