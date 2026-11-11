import type { Conversation, Message } from "@/generated/prisma/client";

export function serializeConversation(
  conversation: Pick<
    Conversation,
    | "id"
    | "workspaceId"
    | "title"
    | "status"
    | "modelKey"
    | "activeLeafMessageId"
    | "lastMessageAt"
    | "createdAt"
    | "updatedAt"
    | "version"
  >
) {
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    title: conversation.title,
    status: conversation.status,
    modelKey: conversation.modelKey,
    activeLeafMessageId: conversation.activeLeafMessageId,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    version: conversation.version
  };
}

export function serializeMessage(
  message: Pick<
    Message,
    | "id"
    | "conversationId"
    | "role"
    | "status"
    | "sequence"
    | "parentMessageId"
    | "supersedesMessageId"
    | "content"
    | "model"
    | "finishReason"
    | "errorCode"
    | "createdAt"
    | "updatedAt"
    | "completedAt"
  > & {
    readonly citations?: readonly {
      readonly ordinal: number;
      readonly documentIdSnapshot: string;
      readonly chunkOrdinalSnapshot: number;
      readonly excerpt: string;
      readonly pageStart: number | null;
      readonly pageEnd: number | null;
      readonly label: string | null;
    }[];
  }
) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    status: message.status,
    sequence: message.sequence.toString(),
    parentMessageId: message.parentMessageId,
    supersedesMessageId: message.supersedesMessageId,
    content: message.content,
    model: message.model,
    finishReason: message.finishReason,
    errorCode: message.errorCode,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    completedAt: message.completedAt?.toISOString() ?? null,
    citations: (message.citations ?? []).map((citation) => ({
      ordinal: citation.ordinal,
      documentId: citation.documentIdSnapshot,
      documentName: citation.label,
      chunkOrdinal: citation.chunkOrdinalSnapshot,
      excerpt: citation.excerpt,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd
    }))
  };
}
