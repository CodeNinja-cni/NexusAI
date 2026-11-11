import { randomUUID } from "node:crypto";

import Link from "next/link";
import type { Route } from "next";

import { StatusPill } from "@/components/ui/status-pill";
import { AdminPageHeader } from "@/modules/administration/components/admin-shell";
import styles from "@/modules/administration/components/administration.module.css";
import { getAdminDashboard } from "@/modules/administration/server/service";
import { requireAdminPagePrincipal } from "@/modules/auth/server/session";

export default async function AdminDashboardPage() {
  const principal = await requireAdminPagePrincipal();
  const data = await getAdminDashboard(principal.user.id, randomUUID());
  const activeUsers = Number(data.users.ACTIVE ?? 0);
  const suspendedUsers = Number(data.users.SUSPENDED ?? 0);
  return (
    <main className={styles.page}>
      <AdminPageHeader
        eyebrow="Control plane"
        title="Operate with evidence, not guesswork."
        description="Platform health, access posture, and real provider usage—aggregated without opening customer content."
      />
      <section className={styles.metrics} aria-label="Platform overview">
        <article className={styles.metric}>
          <span className={styles.eyebrow}>Active users</span>
          <strong>{activeUsers.toLocaleString()}</strong>
          <small>{suspendedUsers} suspended</small>
        </article>
        <article className={styles.metric}>
          <span className={styles.eyebrow}>Live sessions</span>
          <strong>{data.activeSessions.toLocaleString()}</strong>
          <small>Server-side, unexpired</small>
        </article>
        <article className={styles.metric}>
          <span className={styles.eyebrow}>AI requests · 30d</span>
          <strong>{data.usage.requests.toLocaleString()}</strong>
          <small>{Number(data.usage.inputTokens).toLocaleString()} input tokens</small>
        </article>
        <article className={styles.metric}>
          <span className={styles.eyebrow}>Estimated usage cost</span>
          <strong>{formatMicros(data.usage.estimatedCostMicros)}</strong>
          <small>Provider-reported ledger; not billing</small>
        </article>
      </section>
      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Needs attention</h2>
          <ul className={styles.attention}>
            <li>
              <span>Failed outbox events</span>
              <strong>{data.attention.failedOutbox}</strong>
            </li>
            <li>
              <span>Document failures · 24h</span>
              <strong>{data.attention.failedDocuments}</strong>
            </li>
            <li>
              <span>Workflow failures · 24h</span>
              <strong>{data.attention.failedWorkflows}</strong>
            </li>
          </ul>
          <p>
            <Link href={"/admin/activity" as Route}>Inspect system activity →</Link>
          </p>
        </article>
        <article className={styles.panel}>
          <h2>Recent audited activity</h2>
          <ul className={styles.attention}>
            {data.recentActivity.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>{humanize(event.action)}</strong>
                  <small className={styles.muted}>
                    {event.targetType} · {new Date(event.createdAt).toLocaleString()}
                  </small>
                </div>
                <StatusPill tone={event.outcome === "SUCCEEDED" ? "success" : "warning"}>
                  {event.outcome}
                </StatusPill>
              </li>
            ))}
          </ul>
          <p>
            <Link href={"/admin/audit-logs" as Route}>Open immutable trail →</Link>
          </p>
        </article>
      </section>
    </main>
  );
}

function formatMicros(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number(value) / 1_000_000);
}
function humanize(value: string) {
  return value.replaceAll(/[._]/gu, " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());
}
