import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { WorkflowLibrary } from "@/modules/workflows/components/workflow-library";
import { listWorkflows } from "@/modules/workflows/server/workflow-service";
import { getAuthorizedWorkspace } from "@/modules/workspaces/server/authorization";
import { getActiveWorkspaceId } from "@/modules/workspaces/server/workspace-service";

export const metadata: Metadata = {
  title: "Controlled workflows",
  description: "Build, publish, and inspect versioned NEXUS AI workflows."
};

export default async function WorkflowsPage({
  searchParams
}: {
  readonly searchParams: Promise<{ query?: string | string[]; status?: string | string[] }>;
}) {
  const principal = await requireReadyPagePrincipal();
  const workspaceId = await getActiveWorkspaceId(
    principal.user.id,
    principal.provisioning?.personalWorkspaceId ?? null
  );
  if (!workspaceId) redirect("/auth/provisioning");
  const requested = await searchParams;
  const query = typeof requested.query === "string" ? requested.query.trim().slice(0, 200) : "";
  const status = parseStatus(requested.status);
  const [membership, page] = await Promise.all([
    getAuthorizedWorkspace(principal.user.id, workspaceId),
    listWorkflows(principal.user.id, workspaceId, { query, status, limit: 30 })
  ]);
  if (!membership) redirect("/auth/provisioning");
  return (
    <DashboardShell
      workspaceName={membership.workspace.name}
      workspaceKind={titleCase(membership.workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(membership.role)}
    >
      <WorkflowLibrary
        workspaceId={workspaceId}
        workspaceName={membership.workspace.name}
        workflows={page.items}
        query={query}
        status={status}
        canAuthor={membership.role !== "MEMBER"}
      />
    </DashboardShell>
  );
}

function parseStatus(value: string | string[] | undefined) {
  return typeof value === "string" && ["DRAFT", "ACTIVE", "ARCHIVED"].includes(value)
    ? (value as "DRAFT" | "ACTIVE" | "ARCHIVED")
    : ("ALL" as const);
}
function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
