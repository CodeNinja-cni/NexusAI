import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { WorkspaceList } from "@/modules/workspaces/components/workspace-list";
import {
  getActiveWorkspaceId,
  listWorkspaces
} from "@/modules/workspaces/server/workspace-service";

import styles from "./workspace.module.css";

export const metadata: Metadata = {
  title: "Workspaces",
  description: "Create, switch, and manage isolated NEXUS AI workspaces."
};

export default async function WorkspacesPage() {
  const principal = await requireReadyPagePrincipal();
  const [result, activeWorkspaceId] = await Promise.all([
    listWorkspaces(principal.user.id),
    getActiveWorkspaceId(principal.user.id, principal.provisioning?.personalWorkspaceId ?? null)
  ]);
  const active = result.items.find(
    (item) => item.id === activeWorkspaceId && item.status === "ACTIVE"
  );
  if (!active) redirect("/auth/provisioning");

  return (
    <DashboardShell
      workspaceName={active.name}
      workspaceKind={titleCase(active.kind)}
      userName={principal.user.name}
      userRole={titleCase(active.role)}
    >
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <p>Workspace control / isolated by design</p>
            <h1>Choose where your work lives.</h1>
          </div>
          <p>
            Each workspace is a hard authorization boundary. Switch context, create a team, or
            recover a recently deleted workspace from one deliberate control surface.
          </p>
        </header>
        <WorkspaceList initialWorkspaces={result.items} />
      </main>
    </DashboardShell>
  );
}

function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
