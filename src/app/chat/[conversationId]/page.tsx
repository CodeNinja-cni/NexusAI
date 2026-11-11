import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { ChatExperience } from "@/modules/chat/components/chat-experience";
import { getConversation, listMessages } from "@/modules/chat/server/chat-service";
import { listEnabledChatModels } from "@/modules/chat/server/model-catalog";
import { getAuthorizedWorkspace } from "@/modules/workspaces/server/authorization";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";
import { getActiveWorkspaceId } from "@/modules/workspaces/server/workspace-service";

export const metadata: Metadata = {
  title: "Conversation studio",
  description: "Stream, stop, recover, and regenerate a persisted NEXUS AI conversation."
};

export default async function ConversationPage({
  params
}: {
  readonly params: Promise<{ conversationId: string }>;
}) {
  const principal = await requireReadyPagePrincipal();
  const workspaceId = await getActiveWorkspaceId(
    principal.user.id,
    principal.provisioning?.personalWorkspaceId ?? null
  );
  if (!workspaceId) redirect("/auth/provisioning");
  const { conversationId } = await params;
  let conversation: Awaited<ReturnType<typeof getConversation>>;
  let messagePage: Awaited<ReturnType<typeof listMessages>>;
  try {
    [conversation, messagePage] = await Promise.all([
      getConversation(principal.user.id, workspaceId, conversationId),
      listMessages(principal.user.id, workspaceId, conversationId, { limit: 50 })
    ]);
  } catch (error) {
    if (error instanceof WorkspaceDomainError && error.status === 404) notFound();
    throw error;
  }
  const membership = await getAuthorizedWorkspace(principal.user.id, workspaceId);
  if (!membership) redirect("/auth/provisioning");
  const models = listEnabledChatModels();
  const modelKey = models.some((model) => model.key === conversation.modelKey)
    ? (conversation.modelKey ?? models[0]?.key)
    : models[0]?.key;
  if (!modelKey) throw new Error("No chat model is enabled.");

  const chatMessages = messagePage.items
    .filter((message) => message.role === "USER" || message.role === "ASSISTANT")
    .map((message) => ({
      id: message.id,
      role: message.role as "USER" | "ASSISTANT",
      status: message.status,
      content: message.content,
      model: message.model,
      errorCode: message.errorCode,
      supersedesMessageId: message.supersedesMessageId,
      createdAt: message.createdAt,
      citations: message.citations
    }));

  return (
    <DashboardShell
      workspaceName={membership.workspace.name}
      workspaceKind={titleCase(membership.workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(membership.role)}
    >
      <ChatExperience
        workspaceId={workspaceId}
        conversationId={conversation.id}
        title={conversation.title}
        status={conversation.status}
        workspaceName={membership.workspace.name}
        createdAt={conversation.createdAt}
        lastMessageAt={conversation.lastMessageAt}
        initialModelKey={modelKey}
        models={models}
        initialMessages={chatMessages}
        initialHistoryCursor={messagePage.nextCursor}
      />
    </DashboardShell>
  );
}

function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
