import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { ChatIndex } from "@/modules/chat/components/chat-index";
import { listConversations } from "@/modules/chat/server/chat-service";
import { listEnabledChatModels } from "@/modules/chat/server/model-catalog";
import { getAuthorizedWorkspace } from "@/modules/workspaces/server/authorization";
import { getActiveWorkspaceId } from "@/modules/workspaces/server/workspace-service";
import { getUserPreference } from "@/modules/settings/server/preferences";

export const metadata: Metadata = {
  title: "Conversations",
  description: "Persisted, streaming conversations in the active NEXUS AI workspace."
};

export default async function ChatPage({
  searchParams
}: {
  readonly searchParams: Promise<{
    query?: string | string[] | undefined;
    status?: string | string[] | undefined;
    createdByMe?: string | string[] | undefined;
  }>;
}) {
  const principal = await requireReadyPagePrincipal();
  const workspaceId = await getActiveWorkspaceId(
    principal.user.id,
    principal.provisioning?.personalWorkspaceId ?? null
  );
  if (!workspaceId) redirect("/auth/provisioning");
  const requested = await searchParams;
  const query = typeof requested.query === "string" ? requested.query.trim().slice(0, 200) : "";
  const status =
    requested.status === "ARCHIVED" || requested.status === "ALL" ? requested.status : "ACTIVE";
  const createdByMe = requested.createdByMe === "true";
  const [membership, conversationPage, preference] = await Promise.all([
    getAuthorizedWorkspace(principal.user.id, workspaceId),
    listConversations(principal.user.id, workspaceId, {
      query,
      status,
      createdByMe,
      limit: 30
    }),
    getUserPreference(principal.user.id)
  ]);
  if (!membership) redirect("/auth/provisioning");
  const enabledModels = [...listEnabledChatModels()];
  const preferredModelIndex = enabledModels.findIndex(
    (model) => model.key === preference.defaultModelKey
  );
  if (preferredModelIndex > 0) {
    const [preferredModel] = enabledModels.splice(preferredModelIndex, 1);
    if (preferredModel) enabledModels.unshift(preferredModel);
  }

  return (
    <DashboardShell
      workspaceName={membership.workspace.name}
      workspaceKind={titleCase(membership.workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(membership.role)}
    >
      <ChatIndex
        key={`${status}:${createdByMe}:${query}`}
        workspaceId={workspaceId}
        workspaceName={membership.workspace.name}
        conversations={conversationPage.items}
        nextCursor={conversationPage.nextCursor}
        query={query}
        status={status}
        createdByMe={createdByMe}
        models={enabledModels}
      />
    </DashboardShell>
  );
}

function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
