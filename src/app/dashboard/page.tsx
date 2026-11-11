import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Database,
  FilePlus2,
  FileText,
  HardDrive,
  MessageSquarePlus,
  MessagesSquare,
  Settings,
  Sparkles,
  Users
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LogoutButton } from "@/modules/auth/components/logout-button";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { getDashboardData, type DashboardData } from "@/modules/dashboard/server/dashboard-data";
import { getActiveWorkspaceId } from "@/modules/workspaces/server/workspace-service";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Workspace overview",
  description: "Recent work, persisted usage, workspace status, and activity for NEXUS AI."
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short"
});

const shortDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric"
});

const integerFormatter = new Intl.NumberFormat("en");

export default async function DashboardPage() {
  const principal = await requireReadyPagePrincipal();
  const workspaceId = await getActiveWorkspaceId(
    principal.user.id,
    principal.provisioning?.personalWorkspaceId ?? null
  );
  if (!workspaceId) redirect("/auth/provisioning");

  const dashboard = await getDashboardData(principal.user.id, workspaceId);
  if (!dashboard) redirect("/auth/provisioning");

  const firstName = principal.user.name.trim().split(/\s+/u)[0] || "there";
  const totalTokens = dashboard.usage.inputTokens + dashboard.usage.outputTokens;
  const storageUsed = dashboard.workspace.storageQuota?.usedBytes ?? 0n;

  return (
    <DashboardShell
      workspaceName={dashboard.workspace.name}
      workspaceKind={titleCase(dashboard.workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(dashboard.workspace.role)}
    >
      <div className={styles.dashboard}>
        <header className={styles.welcome}>
          <div>
            <p className={styles.eyebrow}>
              Workspace pulse / {shortDateFormatter.format(new Date())}
            </p>
            <h1>Welcome back, {firstName}.</h1>
            <p>
              Your workspace is ready. Every value below is calculated from persisted records in
              <strong> {dashboard.workspace.name}</strong>.
            </p>
          </div>
          <div className={styles.headerActions}>
            <StatusPill tone="success">Workspace active</StatusPill>
            {principal.user.platformRole === "ADMIN" ? (
              <ButtonLink href={"/admin/dashboard" as Route} variant="secondary" size="small">
                Administration
              </ButtonLink>
            ) : null}
            <LogoutButton />
          </div>
        </header>

        <section className={styles.stats} aria-labelledby="usage-title">
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>Usage / persisted</p>
              <h2 id="usage-title">Last 30 days</h2>
            </div>
            <span>
              From {shortDateFormatter.format(dashboard.usage.from)} ·{" "}
              <Link href={"/usage" as Route}>Details</Link>
            </span>
          </div>
          <div className={styles.statGrid}>
            <StatCard
              icon={Sparkles}
              label="Provider operations"
              value={integerFormatter.format(dashboard.usage.operationCount)}
              detail="Recorded attempts"
              tone="blue"
            />
            <StatCard
              icon={Activity}
              label="Tokens processed"
              value={formatCompactBigInt(totalTokens)}
              detail={`${integerFormatter.format(dashboard.usage.inputTokens)} in · ${integerFormatter.format(dashboard.usage.outputTokens)} out`}
              tone="burgundy"
            />
            <StatCard
              icon={Database}
              label="Estimated provider cost"
              value={
                dashboard.usage.unpricedOperationCount > 0
                  ? "Not fully priced"
                  : formatMicros(dashboard.usage.estimatedCostMicros)
              }
              detail={
                dashboard.usage.unpricedOperationCount > 0
                  ? `${integerFormatter.format(dashboard.usage.unpricedOperationCount)} operation${dashboard.usage.unpricedOperationCount === 1 ? "" : "s"} await approved pricing`
                  : "Estimate, not an invoice"
              }
            />
            <StatCard
              icon={HardDrive}
              label="Workspace storage"
              value={formatBytes(storageUsed)}
              detail={formatStorageLimit(dashboard.workspace.storageQuota?.byteLimit)}
            />
          </div>
        </section>

        <div className={styles.primaryGrid}>
          <section className={styles.panel} aria-labelledby="conversations-title">
            <PanelHeading
              eyebrow={`${dashboard.conversationCount} total`}
              title="Recent conversations"
              id="conversations-title"
              icon={<Icon icon={MessagesSquare} />}
            />
            {dashboard.recentConversations.length ? (
              <ul className={styles.resourceList}>
                {dashboard.recentConversations.map((conversation) => (
                  <li key={conversation.id}>
                    <span className={styles.resourceIcon} aria-hidden="true">
                      <Icon icon={MessagesSquare} />
                    </span>
                    <div>
                      <strong>
                        <Link href={`/chat/${conversation.id}` as Route}>{conversation.title}</Link>
                      </strong>
                      <span>
                        {titleCase(conversation.status)} · Updated{" "}
                        {dateFormatter.format(conversation.updatedAt)}
                      </span>
                    </div>
                    <StatusPill tone={conversation.status === "ACTIVE" ? "info" : "neutral"}>
                      {titleCase(conversation.status)}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            ) : (
              <DashboardEmptyState
                icon={<Icon icon={MessageSquarePlus} size={22} />}
                code="CHAT / 000"
                title="No conversations yet"
                description="No sample history has been inserted. Start a persisted conversation when you are ready."
              />
            )}
          </section>

          <section className={styles.panel} aria-labelledby="documents-title">
            <PanelHeading
              eyebrow={`${dashboard.documentCount} total`}
              title="Recent documents"
              id="documents-title"
              icon={<Icon icon={FileText} />}
            />
            {dashboard.recentDocuments.length ? (
              <ul className={styles.resourceList}>
                {dashboard.recentDocuments.map((document) => (
                  <li key={document.id}>
                    <span className={styles.resourceIcon} aria-hidden="true">
                      <Icon icon={FileText} />
                    </span>
                    <div>
                      <strong>
                        <Link href={`/documents/${document.id}` as Route}>{document.name}</Link>
                      </strong>
                      <span>
                        {formatBytes(document.sizeBytes)} · {document.mimeType}
                      </span>
                    </div>
                    <StatusPill tone={documentStatusTone(document.status)}>
                      {titleCase(document.status)}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            ) : (
              <DashboardEmptyState
                icon={<Icon icon={FilePlus2} size={22} />}
                code="DOC / 000"
                title="No documents yet"
                description="Upload a PDF, DOCX, or TXT source to create the first indexed document record."
              />
            )}
          </section>
        </div>

        <div className={styles.secondaryGrid}>
          <section
            className={`${styles.panel} ${styles.workspacePanel}`}
            aria-labelledby="workspace-title"
          >
            <PanelHeading
              eyebrow="Active boundary"
              title="Workspace overview"
              id="workspace-title"
              icon={<Icon icon={Database} />}
            />
            <div className={styles.workspaceIdentity}>
              <span aria-hidden="true">{dashboard.workspace.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{dashboard.workspace.name}</strong>
                <small>
                  {titleCase(dashboard.workspace.kind)} · {titleCase(dashboard.workspace.role)}
                </small>
              </div>
            </div>
            <dl className={styles.workspaceFacts}>
              <div>
                <dt>
                  <Icon icon={Users} /> Members
                </dt>
                <dd>{integerFormatter.format(dashboard.workspace.memberCount)}</dd>
              </div>
              <div>
                <dt>
                  <Icon icon={MessagesSquare} /> Conversations
                </dt>
                <dd>{integerFormatter.format(dashboard.conversationCount)}</dd>
              </div>
              <div>
                <dt>
                  <Icon icon={FileText} /> Documents
                </dt>
                <dd>{integerFormatter.format(dashboard.documentCount)}</dd>
              </div>
              <div>
                <dt>
                  <Icon icon={CalendarDays} /> Created
                </dt>
                <dd>{shortDateFormatter.format(dashboard.workspace.createdAt)}</dd>
              </div>
            </dl>
          </section>

          <section className={`${styles.panel} ${styles.quickPanel}`} aria-labelledby="quick-title">
            <PanelHeading
              eyebrow="Available actions"
              title="Quick actions"
              id="quick-title"
              icon={<Icon icon={ArrowRight} />}
            />
            <div className={styles.quickActions}>
              <ButtonLink
                href="/settings/profile"
                variant="secondary"
                leadingIcon={<Icon icon={Settings} />}
                trailingIcon={<Icon icon={ArrowRight} />}
              >
                Manage profile and sessions
              </ButtonLink>
              <ButtonLink href={"/chat" as Route} leadingIcon={<Icon icon={MessageSquarePlus} />}>
                Start a conversation
              </ButtonLink>
              <ButtonLink
                href={"/documents" as Route}
                variant="secondary"
                leadingIcon={<Icon icon={FilePlus2} />}
              >
                Upload a document
              </ButtonLink>
            </div>
            <p>Available actions are backed by server routes and workspace authorization.</p>
          </section>

          <section
            className={`${styles.panel} ${styles.activityPanel}`}
            aria-labelledby="activity-title"
          >
            <PanelHeading
              eyebrow={`${dashboard.recentActivity.length} shown`}
              title="Recent activity"
              id="activity-title"
              icon={<Icon icon={Activity} />}
            />
            {dashboard.recentActivity.length ? (
              <ol className={styles.activityList}>
                {dashboard.recentActivity.map((event) => (
                  <li key={event.id}>
                    <span className={styles.activityNode} aria-hidden="true" />
                    <div>
                      <strong>{formatAction(event.action)}</strong>
                      <span>
                        {titleCase(event.targetType)} · {dateFormatter.format(event.createdAt)}
                      </span>
                    </div>
                    <StatusPill tone={event.outcome === "SUCCEEDED" ? "success" : "danger"}>
                      {titleCase(event.outcome)}
                    </StatusPill>
                  </li>
                ))}
              </ol>
            ) : (
              <DashboardEmptyState
                icon={<Icon icon={Activity} size={22} />}
                code="LOG / 000"
                title="No workspace activity"
                description="Auditable workspace events will appear here as they are persisted."
              />
            )}
          </section>
        </div>

        <footer className={styles.dashboardFooter}>
          <span>NXS / Workspace data refreshed for this request</span>
          <Link href="/design-system">Interface protocol</Link>
        </footer>
      </div>
    </DashboardShell>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  tone = "neutral"
}: {
  readonly icon: Parameters<typeof Icon>[0]["icon"];
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: "neutral" | "blue" | "burgundy" | undefined;
}) {
  return (
    <article className={styles.statCard} data-tone={tone}>
      <div>
        <span className={styles.statIcon} aria-hidden="true">
          <Icon icon={icon} />
        </span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PanelHeading({
  eyebrow,
  title,
  id,
  icon
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly id: string;
  readonly icon: React.ReactNode;
}) {
  return (
    <header className={styles.panelHeading}>
      <div>
        <span>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <span className={styles.panelIcon} aria-hidden="true">
        {icon}
      </span>
    </header>
  );
}

function DashboardEmptyState({
  icon,
  code,
  title,
  description
}: {
  readonly icon: React.ReactNode;
  readonly code: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      <div>
        <span>{code}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
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

function formatAction(action: string) {
  return titleCase(action);
}

function formatBytes(bytes: bigint) {
  if (bytes === 0n) return "0 B";
  const value = Number(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** unitIndex;
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: scaled < 10 ? 1 : 0 }).format(scaled)} ${units[unitIndex]}`;
}

function formatStorageLimit(limit: bigint | null | undefined) {
  return limit === null || limit === undefined
    ? "No storage limit configured"
    : `of ${formatBytes(limit)}`;
}

function formatCompactBigInt(value: bigint) {
  if (value < 1000n) return integerFormatter.format(value);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function formatMicros(value: bigint) {
  const whole = value / 1_000_000n;
  const fractional = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `US$${whole.toString()}${fractional ? `.${fractional}` : ".00"}`;
}

function documentStatusTone(status: DashboardData["recentDocuments"][number]["status"]) {
  if (status === "READY") return "success" as const;
  if (status === "FAILED" || status === "QUARANTINED") return "danger" as const;
  if (status === "PROCESSING" || status === "QUEUED") return "info" as const;
  return "neutral" as const;
}
