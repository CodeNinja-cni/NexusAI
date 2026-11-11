import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { listEnabledChatModels } from "@/modules/chat/server/model-catalog";
import { WorkflowStudio } from "@/modules/workflows/components/workflow-studio";
import { getWorkflow, listWorkflowExecutions } from "@/modules/workflows/server/workflow-service";
import { getAuthorizedWorkspace } from "@/modules/workspaces/server/authorization";
import { getActiveWorkspaceId } from "@/modules/workspaces/server/workspace-service";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";

export const metadata: Metadata = {
  title: "Workflow studio",
  description: "Compose and inspect a controlled NEXUS AI workflow."
};

export default async function WorkflowPage({
  params
}: {
  readonly params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = await params;
  const principal = await requireReadyPagePrincipal();
  const workspaceId = await getActiveWorkspaceId(
    principal.user.id,
    principal.provisioning?.personalWorkspaceId ?? null
  );
  if (!workspaceId) redirect("/auth/provisioning");
  const membership = await getAuthorizedWorkspace(principal.user.id, workspaceId);
  if (!membership) redirect("/auth/provisioning");
  let data;
  try {
    data = await Promise.all([
      getWorkflow(principal.user.id, workspaceId, workflowId),
      listWorkflowExecutions(principal.user.id, workspaceId, workflowId, { limit: 20 })
    ]);
  } catch (error) {
    if (error instanceof WorkspaceDomainError && error.status === 404) notFound();
    throw error;
  }
  const [workflow, executions] = data;
  return (
    <DashboardShell
      workspaceName={membership.workspace.name}
      workspaceKind={titleCase(membership.workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(membership.role)}
    >
      <WorkflowStudio
        workspaceId={workspaceId}
        workflow={workflow}
        executions={executions.items}
        models={listEnabledChatModels().map((model) => ({ key: model.key, label: model.label }))}
        canAuthor={membership.role !== "MEMBER"}
      />
    </DashboardShell>
  );
}

function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
