import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { listEnabledChatModels } from "@/modules/chat/server/model-catalog";
import { DocumentDetail } from "@/modules/documents/components/document-detail";
import { getDocument } from "@/modules/documents/server/document-service";
import { getAuthorizedWorkspace } from "@/modules/workspaces/server/authorization";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";
import { getActiveWorkspaceId } from "@/modules/workspaces/server/workspace-service";

export const metadata: Metadata = {
  title: "Document record",
  description:
    "Processing status, extracted summary, retrieval metadata, and grounded document questions."
};

export default async function DocumentPage({
  params
}: {
  readonly params: Promise<{ documentId: string }>;
}) {
  const principal = await requireReadyPagePrincipal();
  const workspaceId = await getActiveWorkspaceId(
    principal.user.id,
    principal.provisioning?.personalWorkspaceId ?? null
  );
  if (!workspaceId) redirect("/auth/provisioning");
  const { documentId } = await params;
  let document: Awaited<ReturnType<typeof getDocument>>;
  try {
    document = await getDocument(principal.user.id, workspaceId, documentId);
  } catch (error) {
    if (error instanceof WorkspaceDomainError && error.status === 404) notFound();
    throw error;
  }
  const membership = await getAuthorizedWorkspace(principal.user.id, workspaceId);
  if (!membership) redirect("/auth/provisioning");
  const modelKey = listEnabledChatModels()[0]?.key;
  if (!modelKey) throw new Error("No chat model is enabled.");
  return (
    <DashboardShell
      workspaceName={membership.workspace.name}
      workspaceKind={titleCase(membership.workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(membership.role)}
    >
      <DocumentDetail workspaceId={workspaceId} initialDocument={document} modelKey={modelKey} />
    </DashboardShell>
  );
}

function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
