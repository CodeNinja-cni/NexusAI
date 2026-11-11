import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ArrowUpRight,
  CalendarClock,
  ChartNoAxesCombined,
  CircleDollarSign,
  Gauge,
  Sparkles
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { EmptyState } from "@/components/feedback/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { getUsagePageData } from "@/modules/usage/server/analytics";
import { getQuotaSnapshot } from "@/modules/usage/server/quota";
import { QuotaSettings } from "@/modules/usage/components/quota-settings";
import { getActiveWorkspaceId, getWorkspace } from "@/modules/workspaces/server/workspace-service";

import styles from "./usage.module.css";

export const metadata: Metadata = {
  title: "Usage intelligence",
  description: "Provider-reported AI usage, estimated cost coverage, and workspace quotas."
};

const integer = new Intl.NumberFormat("en");
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export default async function UsagePage() {
  const principal = await requireReadyPagePrincipal();
  const workspaceId = await getActiveWorkspaceId(
    principal.user.id,
    principal.provisioning?.personalWorkspaceId ?? null
  );
  if (!workspaceId) redirect("/auth/provisioning");
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const [workspace, data, quota] = await Promise.all([
    getWorkspace(principal.user.id, workspaceId),
    getUsagePageData(principal.user.id, workspaceId, { from, to }),
    getQuotaSnapshot(principal.user.id, workspaceId)
  ]);
  const totals = data.summary.totals;
  const totalTokens = BigInt(totals.inputTokens) + BigInt(totals.outputTokens);
  const maxDailyTokens = data.summary.breakdown.reduce((maximum, row) => {
    const tokens = BigInt(row.inputTokens) + BigInt(row.outputTokens);
    return tokens > maximum ? tokens : maximum;
  }, 0n);

  return (
    <DashboardShell
      workspaceName={workspace.name}
      workspaceKind={titleCase(workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(workspace.role)}
    >
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Usage intelligence / immutable ledger</p>
            <h1>Know exactly what the workspace consumed.</h1>
            <p>
              Provider responses drive the ledger. Prices are applied only from approved,
              effective-dated catalog rows; every gap remains visibly unpriced.
            </p>
          </div>
          <div className={styles.window}>
            <Icon icon={CalendarClock} />
            <span>Rolling 30 days</span>
            <strong>
              {shortDate.format(from)} — {shortDate.format(to)}
            </strong>
          </div>
        </header>

        <section className={styles.metrics} aria-label="Usage totals">
          <Metric
            icon={Sparkles}
            label="AI requests"
            value={integer.format(totals.aiRequests)}
            detail="Provider attempts"
          />
          <Metric
            icon={ChartNoAxesCombined}
            label="Tokens"
            value={compact.format(totalTokens)}
            detail={`${integer.format(BigInt(totals.inputTokens))} input · ${integer.format(BigInt(totals.outputTokens))} output`}
          />
          <Metric
            icon={CircleDollarSign}
            label="Estimated cost"
            value={
              totals.unpricedRequests > 0
                ? "Coverage incomplete"
                : formatMicros(BigInt(totals.estimatedCostMicros))
            }
            detail={
              totals.unpricedRequests > 0
                ? `${integer.format(totals.unpricedRequests)} unpriced request${totals.unpricedRequests === 1 ? "" : "s"}`
                : "Estimate, never an invoice"
            }
          />
          <Metric
            icon={Gauge}
            label="Usage provenance"
            value={totals.unavailableUsageRequests > 0 ? "Partial" : "Complete"}
            detail={`${integer.format(totals.developmentEstimateRequests)} development estimate${totals.developmentEstimateRequests === 1 ? "" : "s"}`}
          />
        </section>

        <section className={styles.panel} aria-labelledby="daily-title">
          <PanelHeader eyebrow="Daily aggregate" title="Consumption cadence" id="daily-title" />
          {data.summary.breakdown.length ? (
            <div
              className={styles.chart}
              role="img"
              aria-label="Daily input and output token totals for the last 30 days"
            >
              {data.summary.breakdown.map((row) => {
                const input = BigInt(row.inputTokens);
                const output = BigInt(row.outputTokens);
                const total = input + output;
                const height =
                  maxDailyTokens === 0n ? 0 : Math.max(4, Number((total * 100n) / maxDailyTokens));
                const inputShare = total === 0n ? 0 : Number((input * 100n) / total);
                return (
                  <div
                    className={styles.barColumn}
                    key={row.bucket}
                    title={`${shortDate.format(new Date(row.bucket))}: ${integer.format(total)} tokens`}
                  >
                    <span className={styles.barTrack}>
                      <span style={{ height: `${height}%` }}>
                        <i style={{ height: `${inputShare}%` }} />
                      </span>
                    </span>
                    <small>{shortDate.format(new Date(row.bucket))}</small>
                  </div>
                );
              })}
              <div className={styles.legend}>
                <span data-input /> Input <span data-output /> Output
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Icon icon={ChartNoAxesCombined} />}
              title="No usage in this window"
              description="The chart will appear after an AI provider attempt is persisted."
            />
          )}
        </section>

        <section className={styles.panel} aria-labelledby="quota-title">
          <PanelHeader
            eyebrow={`Resets ${dateTime.format(new Date(quota.periodEnd))}`}
            title="Monthly workspace quota"
            id="quota-title"
          />
          <div className={styles.quotaSummary}>
            <QuotaMeter
              label="Requests"
              consumed={quota.consumed.requests}
              reserved={quota.reserved.requests}
              limit={quota.limits.requests}
            />
            <QuotaMeter
              label="Input tokens"
              consumed={quota.consumed.inputTokens}
              reserved={quota.reserved.inputTokens}
              limit={quota.limits.inputTokens}
            />
            <QuotaMeter
              label="Output tokens"
              consumed={quota.consumed.outputTokens}
              reserved={quota.reserved.outputTokens}
              limit={quota.limits.outputTokens}
            />
            <QuotaMeter
              label="Estimated cost"
              consumed={quota.consumed.estimatedCostMicros}
              reserved={quota.reserved.estimatedCostMicros}
              limit={quota.limits.estimatedCostMicros}
              cost
            />
          </div>
          <QuotaSettings
            workspaceId={workspaceId}
            policyVersion={quota.policyVersion}
            limits={quota.limits}
            canManage={quota.canManage}
          />
        </section>

        <section className={styles.panel} aria-labelledby="ledger-title">
          <PanelHeader
            eyebrow={data.records.scope === "workspace" ? "Workspace scope" : "Your requests"}
            title="Recent ledger records"
            id="ledger-title"
          />
          {data.records.items.length ? (
            <DataTable caption="Recent AI usage records">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Provider / model</th>
                  <th>Status</th>
                  <th>Tokens</th>
                  <th>Estimated cost</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.records.items.map((record) => (
                  <tr key={record.id}>
                    <td>{dateTime.format(new Date(record.occurredAt))}</td>
                    <td>
                      <strong>{record.provider}</strong>
                      <small>{record.model}</small>
                    </td>
                    <td>
                      <StatusPill
                        tone={
                          record.status === "SUCCEEDED"
                            ? "success"
                            : record.status === "CANCELLED"
                              ? "neutral"
                              : "danger"
                        }
                      >
                        {titleCase(record.status)}
                      </StatusPill>
                    </td>
                    <td>
                      {integer.format(BigInt(record.inputTokens) + BigInt(record.outputTokens))}
                      <small>
                        {integer.format(BigInt(record.inputTokens))} in ·{" "}
                        {integer.format(BigInt(record.outputTokens))} out
                      </small>
                    </td>
                    <td>
                      {record.pricingStatus === "PRICED"
                        ? formatMicros(BigInt(record.estimatedCostMicros))
                        : "Unpriced"}
                      <small>
                        {record.pricingStatus === "PRICED"
                          ? record.pricingVersion
                          : "No approved effective price"}
                      </small>
                    </td>
                    <td>{titleCase(record.usageSource)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              icon={<Icon icon={Sparkles} />}
              title="The ledger is empty"
              description="No provider attempts were recorded in this workspace during the selected window."
            />
          )}
          <footer className={styles.panelFooter}>
            <span>Token values are strings in the API to preserve 64-bit precision.</span>
            <a href={`/api/v1/usage/records?workspaceId=${workspaceId}`}>
              Open records API <Icon icon={ArrowUpRight} />
            </a>
          </footer>
        </section>
      </main>
    </DashboardShell>
  );
}

function Metric({
  icon,
  label,
  value,
  detail
}: {
  icon: Parameters<typeof Icon>[0]["icon"];
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className={styles.metric}>
      <span>
        <Icon icon={icon} /> {label}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PanelHeader({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <header className={styles.panelHeader}>
      <div>
        <span>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <span>NXS / 09</span>
    </header>
  );
}

function QuotaMeter({
  label,
  consumed,
  reserved,
  limit,
  cost = false
}: {
  label: string;
  consumed: string;
  reserved: string;
  limit: string | null;
  cost?: boolean;
}) {
  const used = BigInt(consumed) + BigInt(reserved);
  const maximum = limit === null ? null : BigInt(limit);
  const percentage =
    maximum === null || maximum === 0n
      ? maximum === 0n && used > 0n
        ? 100
        : 0
      : Math.min(100, Number((used * 100n) / maximum));
  const format = (value: bigint) => (cost ? formatMicros(value) : compact.format(value));
  return (
    <div className={styles.quotaMeter}>
      <div>
        <strong>{label}</strong>
        <span>
          {format(BigInt(consumed))} consumed · {format(BigInt(reserved))} reserved
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} quota`}
        aria-valuemin={0}
        aria-valuemax={maximum === null ? undefined : 100}
        aria-valuenow={maximum === null ? undefined : percentage}
        aria-valuetext={
          maximum === null
            ? `${format(used)} used, unlimited`
            : `${format(used)} of ${format(maximum)} used`
        }
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <small>{maximum === null ? "Unlimited" : `${format(maximum)} limit`}</small>
    </div>
  );
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[._-]+/u)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
function formatMicros(value: bigint) {
  const whole = value / 1_000_000n;
  const fractional = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `US$${whole.toString()}${fractional ? `.${fractional}` : ".00"}`;
}
