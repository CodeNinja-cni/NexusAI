import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { DocumentLibrary } from "@/modules/documents/components/document-library";
import { listDocuments, type DocumentListInput } from "@/modules/documents/server/document-service";
import { getAuthorizedWorkspace } from "@/modules/workspaces/server/authorization";
import { getActiveWorkspaceId } from "@/modules/workspaces/server/workspace-service";
import { getServerEnvironment } from "@/platform/env/server";

export const metadata: Metadata = {
  title: "Document intelligence",
  description: "Securely upload, process, search, and question private workspace documents."
};

export default async function DocumentsPage({
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
    listDocuments(principal.user.id, workspaceId, { query, status, createdByMe: false, limit: 30 })
  ]);
  if (!membership) redirect("/auth/provisioning");
  return (
    <DashboardShell
      workspaceName={membership.workspace.name}
      workspaceKind={titleCase(membership.workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(membership.role)}
    >
      <DocumentLibrary
        workspaceId={workspaceId}
        workspaceName={membership.workspace.name}
        documents={page.items}
        query={query}
        status={status}
        maximumBytes={getServerEnvironment().documents.maxBytes}
      />
    </DashboardShell>
  );
}

function parseStatus(value: string | string[] | undefined): DocumentListInput["status"] {
  return typeof value === "string" &&
    [
      "UPLOADING",
      "UPLOADED",
      "QUEUED",
      "PROCESSING",
      "READY",
      "FAILED",
      "QUARANTINED",
      "DELETING"
    ].includes(value)
    ? (value as DocumentListInput["status"])
    : "ALL";
}
function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
