"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowUpRight, GitBranch, Plus, Search, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField, SelectField, TextAreaField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import styles from "./workflows.module.css";

interface WorkflowItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly updatedAt: string;
  readonly versionCount?: number;
  readonly executionCount?: number;
  readonly activeVersion?: { readonly versionNumber: number } | null;
}

export function WorkflowLibrary({
  workspaceId,
  workspaceName,
  workflows,
  query,
  status,
  canAuthor
}: {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workflows: readonly WorkflowItem[];
  readonly query: string;
  readonly status: string;
  readonly canAuthor: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const workflow = await api<WorkflowItem>(`/api/v1/workspaces/${workspaceId}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? "") || undefined
        })
      });
      router.push(`/workflows/${workflow.id}` as Route);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workflow could not be created.");
      setCreating(false);
    }
  }

  return (
    <main className={styles.library}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>CONTROL PLANE / {workspaceName}</p>
          <h1>Repeatable intelligence, constrained by design.</h1>
          <p>
            Compose small, inspectable graphs. Every run binds to an immutable version and leaves a
            redacted operational trail.
          </p>
        </div>
        <div className={styles.guardrailCard}>
          <Icon icon={ShieldCheck} />
          <strong>Allow-listed execution</strong>
          <span>No code, shell, SQL, filesystem, or general network nodes.</span>
        </div>
      </header>

      {canAuthor ? (
        <section className={styles.createPanel} aria-labelledby="create-workflow-title">
          <div>
            <p className={styles.eyebrow}>NEW GRAPH / DRAFT</p>
            <h2 id="create-workflow-title">Create a workflow shell</h2>
            <p>Start with metadata, then save and publish an immutable graph version.</p>
          </div>
          <form onSubmit={(event) => void create(event)}>
            <FormField label="Workflow name" name="name" minLength={2} maxLength={120} required />
            <TextAreaField
              label="Purpose"
              name="description"
              maxLength={500}
              rows={2}
              optional
              placeholder="What should this workflow consistently accomplish?"
            />
            <Button
              type="submit"
              loading={creating}
              loadingLabel="Creating"
              leadingIcon={<Icon icon={Plus} />}
            >
              Create draft
            </Button>
          </form>
          {error ? (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={styles.collection} aria-labelledby="workflow-library-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>{workflows.length} LIVE DATABASE RECORDS</p>
            <h2 id="workflow-library-title">Workflow library</h2>
          </div>
          <form action="/workflows" className={styles.filters}>
            <FormField
              label="Search workflows"
              name="query"
              defaultValue={query}
              placeholder="Name or purpose"
            />
            <SelectField label="Lifecycle" name="status" defaultValue={status}>
              <option value="ALL">All states</option>
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
              <option value="ARCHIVED">Archived</option>
            </SelectField>
            <Button type="submit" variant="secondary" leadingIcon={<Icon icon={Search} />}>
              Filter
            </Button>
          </form>
        </div>
        {workflows.length ? (
          <ul className={styles.workflowGrid}>
            {workflows.map((workflow) => (
              <li key={workflow.id}>
                <Link href={`/workflows/${workflow.id}` as Route} className={styles.workflowCard}>
                  <span className={styles.cardIcon}>
                    <Icon icon={GitBranch} />
                  </span>
                  <div>
                    <div className={styles.cardTitle}>
                      <h3>{workflow.name}</h3>
                      <StatusPill tone={tone(workflow.status)}>
                        {titleCase(workflow.status)}
                      </StatusPill>
                    </div>
                    <p>{workflow.description ?? "No purpose statement has been added yet."}</p>
                    <dl>
                      <div>
                        <dt>Versions</dt>
                        <dd>{workflow.versionCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Executions</dt>
                        <dd>{workflow.executionCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Published</dt>
                        <dd>
                          {workflow.activeVersion
                            ? `v${workflow.activeVersion.versionNumber}`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <Icon icon={ArrowUpRight} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <Icon icon={GitBranch} />
            <p className={styles.eyebrow}>GRAPH INDEX / 000</p>
            <h3>No matching workflows</h3>
            <p>
              {canAuthor
                ? "Create the first controlled workflow above."
                : "An Admin can publish a workflow for this workspace."}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as { data?: T; detail?: string } | null;
  if (!response.ok) throw new Error(payload?.detail ?? "The request could not be completed.");
  return payload?.data as T;
}
function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
function tone(status: string): "neutral" | "success" | "warning" {
  return status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral";
}
