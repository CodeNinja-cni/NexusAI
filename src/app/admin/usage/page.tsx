import { randomUUID } from "node:crypto";

import { DataTable } from "@/components/ui/data-table";
import { AdminPageHeader } from "@/modules/administration/components/admin-shell";
import styles from "@/modules/administration/components/administration.module.css";
import {
  getAdminUsageSummary,
  listAdminUsageRecords
} from "@/modules/administration/server/service";
import { requireAdminPagePrincipal } from "@/modules/auth/server/session";

export default async function AdminUsagePage() {
  const principal = await requireAdminPagePrincipal();
  const [summary, records] = await Promise.all([
    getAdminUsageSummary(principal.user.id, { groupBy: "model" }, randomUUID()),
    listAdminUsageRecords(principal.user.id, { limit: 30 }, randomUUID())
  ]);
  return (
    <main className={styles.page}>
      <AdminPageHeader
        eyebrow="Provider ledger"
        title="Usage across the platform."
        description="Aggregates and operational records originate from provider responses or explicitly labeled development estimates. Values are never invented."
      />
      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span className={styles.eyebrow}>Requests</span>
          <strong>{summary.totals.requests}</strong>
          <small>Selected 30-day window</small>
        </article>
        <article className={styles.metric}>
          <span className={styles.eyebrow}>Input tokens</span>
          <strong>{Number(summary.totals.inputTokens).toLocaleString()}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.eyebrow}>Output tokens</span>
          <strong>{Number(summary.totals.outputTokens).toLocaleString()}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.eyebrow}>Estimated cost</span>
          <strong>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              Number(summary.totals.estimatedCostMicros) / 1_000_000
            )}
          </strong>
          <small>Not an invoice</small>
        </article>
      </section>
      <DataTable caption="Usage by model">
        <thead>
          <tr>
            <th>Model</th>
            <th>Requests</th>
            <th>Input tokens</th>
            <th>Output tokens</th>
            <th>Estimated cost</th>
          </tr>
        </thead>
        <tbody>
          {summary.breakdown.map((row) => (
            <tr key={String(row.bucket)}>
              <td>{String(row.bucket)}</td>
              <td>{row.requests}</td>
              <td>{Number(row.inputTokens).toLocaleString()}</td>
              <td>{Number(row.outputTokens).toLocaleString()}</td>
              <td>
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                  Number(row.estimatedCostMicros) / 1_000_000
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <DataTable caption="Recent operational usage records">
        <thead>
          <tr>
            <th>Occurred</th>
            <th>Provider / model</th>
            <th>Operation</th>
            <th>Status</th>
            <th>Tokens</th>
            <th>Scope</th>
          </tr>
        </thead>
        <tbody>
          {records.items.map((record) => (
            <tr key={record.id}>
              <td>{new Date(record.occurredAt).toLocaleString()}</td>
              <td>
                {record.provider} / {record.model}
              </td>
              <td>{record.operation}</td>
              <td>{record.status}</td>
              <td>{(Number(record.inputTokens) + Number(record.outputTokens)).toLocaleString()}</td>
              <td className={styles.code}>{record.workspaceId ?? "No workspace"}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </main>
  );
}
