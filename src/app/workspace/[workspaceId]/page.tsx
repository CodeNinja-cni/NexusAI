import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Icon } from "@/components/ui/icon";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { WorkspaceDetail } from "@/modules/workspaces/components/workspace-detail";
import { workspaceIdSchema } from "@/modules/workspaces/server/authorization";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";
import {
  getWorkspace,
  listInvitations,
  listMembers
} from "@/modules/workspaces/server/workspace-service";

import styles from "../workspace.module.css";

export const metadata: Metadata = { title: "Manage workspace" };

export default async function WorkspaceDetailPage({
  params
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const principal = await requireReadyPagePrincipal();
  const { workspaceId } = await params;
  const parsedWorkspaceId = workspaceIdSchema.safeParse(workspaceId);
  if (!parsedWorkspaceId.success) notFound();
  let workspace: Awaited<ReturnType<typeof getWorkspace>>;
  try {
    workspace = await getWorkspace(principal.user.id, parsedWorkspaceId.data);
  } catch (error) {
    if (error instanceof WorkspaceDomainError && error.status === 404) notFound();
    throw error;
  }
  const memberResult = await listMembers(principal.user.id, workspace.id);
  const invitations =
    workspace.kind === "TEAM" && workspace.role !== "MEMBER"
      ? await listInvitations(principal.user.id, workspace.id)
      : [];

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
            <Link href="/workspace">
              <Icon icon={ArrowLeft} /> All workspaces
            </Link>
            <p>Workspace administration / {workspace.kind.toLowerCase()}</p>
            <h1>{workspace.name}</h1>
          </div>
          <p>
            Manage this boundary’s identity, invitations, membership, roles, and ownership. The
            server rechecks your current role for every operation.
          </p>
        </header>
        <WorkspaceDetail
          workspace={workspace}
          members={memberResult.items}
          invitations={invitations}
          currentUserId={principal.user.id}
        />
      </main>
    </DashboardShell>
  );
}

function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
