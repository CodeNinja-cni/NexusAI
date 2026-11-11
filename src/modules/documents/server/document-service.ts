import "server-only";

import { createHash } from "node:crypto";

import { Prisma, type DocumentStatus, type WorkspaceRole } from "@/generated/prisma/client";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { getObjectStorage } from "@/platform/storage";
import { publishDocumentProcessingJob } from "@/platform/queue/document-queue";

import { SUPPORTED_DOCUMENT_TYPES } from "./extraction";
import type { SupportedMimeType } from "./validation";

const DOCUMENT_RECOVERY_DAYS = 30;
export const DOCUMENT_UPLOAD_GRANT_SECONDS = 5 * 60;
export const DOCUMENT_DOWNLOAD_GRANT_SECONDS = 60;
const DOCUMENT_SELECT = {
  id: true,
  workspaceId: true,
  createdByUserId: true,
  name: true,
  originalFilename: true,
  status: true,
  mimeType: true,
  detectedMimeType: true,
  sizeBytes: true,
  pageCount: true,
  summary: true,
  failureCode: true,
  activeProcessingRunId: true,
  uploadedAt: true,
  processedAt: true,
  createdAt: true,
  updatedAt: true,
  version: true
} satisfies Prisma.DocumentSelect;

export interface DocumentListInput {
  readonly query: string;
  readonly status: DocumentStatus | "ALL";
  readonly mimeType?: SupportedMimeType | undefined;
  readonly createdByMe: boolean;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export async function createDocumentUploadIntent(
  userId: string,
  workspaceId: string,
  input: {
    readonly filename: string;
    readonly mimeType: SupportedMimeType;
    readonly sizeBytes: number;
    readonly sha256: string;
  },
  idempotencyKey: string,
  requestId: string
) {
  validateUpload(input);
  const result = await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
      await requireMembership(userId, workspaceId, transaction);
      const replay = await transaction.document.findUnique({ where: { id: idempotencyKey } });
      if (replay) {
        if (
          replay.workspaceId !== workspaceId ||
          replay.createdByUserId !== userId ||
          replay.originalFilename !== input.filename ||
          replay.mimeType !== input.mimeType ||
          replay.sizeBytes !== BigInt(input.sizeBytes) ||
          replay.sha256 !== input.sha256
        ) {
          throw new WorkspaceDomainError(
            409,
            "idempotency_conflict",
            "Idempotency key conflict",
            "Use a new idempotency key for this upload."
          );
        }
        return replay;
      }
      const quota = await transaction.workspaceStorageQuota.upsert({
        where: { workspaceId },
        create: { workspaceId },
        update: {}
      });
      const totalBytes = quota.usedBytes + quota.reservedBytes + BigInt(input.sizeBytes);
      const totalDocuments = quota.documentCount + quota.reservedDocumentCount + 1;
      if (quota.byteLimit !== null && totalBytes > quota.byteLimit) throw quotaExceeded();
      if (quota.documentLimit !== null && totalDocuments > quota.documentLimit)
        throw quotaExceeded();
      await transaction.workspaceStorageQuota.update({
        where: { workspaceId },
        data: {
          reservedBytes: { increment: BigInt(input.sizeBytes) },
          reservedDocumentCount: { increment: 1 },
          version: { increment: 1 }
        }
      });
      const document = await transaction.document.create({
        data: {
          id: idempotencyKey,
          workspaceId,
          createdByUserId: userId,
          name: input.filename,
          originalFilename: input.filename,
          storageKey: `workspaces/${workspaceId}/documents/${idempotencyKey}/original`,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          sha256: input.sha256
        }
      });
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "document.upload_intent_created",
          targetType: "Document",
          targetId: document.id,
          outcome: "SUCCEEDED",
          requestId,
          metadata: { mimeType: input.mimeType, sizeBytes: input.sizeBytes }
        }
      });
      return document;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  const grant = await getObjectStorage().createUploadGrant({
    key: result.storageKey,
    contentType: result.mimeType,
    sizeBytes: Number(result.sizeBytes),
    expiresInSeconds: DOCUMENT_UPLOAD_GRANT_SECONDS
  });
  return { document: serializeDocument(result), upload: grant };
}

export async function completeDocumentUpload(
  userId: string,
  workspaceId: string,
  documentId: string,
  sha256: string,
  requestId: string
) {
  const current = await prisma.document.findUnique({
    where: { id_workspaceId: { id: documentId, workspaceId }, deletedAt: null }
  });
  if (!current) throw documentNotFound();
  await requireDocumentManager(userId, workspaceId, current.createdByUserId);
  if (current.sha256 !== sha256) throw uploadMismatch();
  if (["QUEUED", "PROCESSING", "READY"].includes(current.status)) {
    return getDocument(userId, workspaceId, documentId);
  }
  if (current.status !== "UPLOADING") throw invalidDocumentState();
  const metadata = await getObjectStorage().headObject(current.storageKey);
  if (
    !metadata ||
    metadata.sizeBytes !== Number(current.sizeBytes) ||
    metadata.contentType !== current.mimeType
  ) {
    throw uploadMismatch();
  }

  await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${documentId}, 0))`;
      const document = await transaction.document.findUnique({
        where: { id_workspaceId: { id: documentId, workspaceId }, deletedAt: null }
      });
      if (!document) throw documentNotFound();
      if (["QUEUED", "PROCESSING", "READY"].includes(document.status)) return;
      if (document.status !== "UPLOADING" || document.sha256 !== sha256) {
        throw invalidDocumentState();
      }
      const run = await transaction.documentProcessingRun.create({
        data: {
          workspaceId,
          documentId,
          status: "QUEUED",
          attempt: 1,
          extractor: "pending",
          extractorVersion: "1",
          chunkerVersion: "character-v1"
        }
      });
      await transaction.document.update({
        where: { id: documentId },
        data: {
          status: "QUEUED",
          storageVersionId: metadata.versionId,
          uploadedAt: new Date(),
          failureCode: null,
          version: { increment: 1 }
        }
      });
      await transaction.workspaceStorageQuota.update({
        where: { workspaceId },
        data: {
          reservedBytes: { decrement: document.sizeBytes },
          reservedDocumentCount: { decrement: 1 },
          usedBytes: { increment: document.sizeBytes },
          documentCount: { increment: 1 },
          version: { increment: 1 }
        }
      });
      await transaction.outboxEvent.create({
        data: {
          deduplicationKey: deduplicationKey("document-processing", run.id),
          topic: "document.processing.requested",
          aggregateType: "Document",
          aggregateId: documentId,
          workspaceId,
          payload: { workspaceId, documentId, runId: run.id }
        }
      });
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "document.upload_completed",
          targetType: "Document",
          targetId: documentId,
          outcome: "SUCCEEDED",
          requestId,
          metadata: { runId: run.id }
        }
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  const queuedRun = await prisma.documentProcessingRun.findFirst({
    where: { workspaceId, documentId, status: { in: ["QUEUED", "PROCESSING"] } },
    orderBy: { attempt: "desc" },
    select: { id: true }
  });
  if (queuedRun) {
    try {
      await publishDocumentProcessingJob({ workspaceId, documentId, runId: queuedRun.id });
      await prisma.$transaction([
        prisma.documentProcessingRun.update({
          where: { id: queuedRun.id },
          data: { queueJobId: queuedRun.id }
        }),
        prisma.outboxEvent.updateMany({
          where: {
            deduplicationKey: deduplicationKey("document-processing", queuedRun.id),
            status: { not: "PUBLISHED" }
          },
          data: {
            status: "PUBLISHED",
            attempts: { increment: 1 },
            publishedAt: new Date(),
            lastErrorRedacted: null
          }
        })
      ]);
      if (getServerEnvironment().queue.driver === "direct") {
        setTimeout(() => {
          void import("./worker")
            .then(({ processDocumentJob }) =>
              processDocumentJob({ workspaceId, documentId, runId: queuedRun.id })
            )
            .catch(() =>
              console.error("Direct document processing failed", { runId: queuedRun.id })
            );
        }, 0);
      }
    } catch {
      // The durable outbox remains pending for the dispatcher to retry.
    }
  }
  return getDocument(userId, workspaceId, documentId);
}

export async function listDocuments(userId: string, workspaceId: string, input: DocumentListInput) {
  const membership = await requireMembership(userId, workspaceId);
  const cursor = input.cursor ? decodeCursor(input.cursor, input) : null;
  const filters: Prisma.DocumentWhereInput[] = [];
  if (input.query) {
    filters.push({
      OR: [
        { name: { contains: input.query, mode: "insensitive" } },
        { summary: { contains: input.query, mode: "insensitive" } },
        { chunks: { some: { content: { contains: input.query, mode: "insensitive" } } } }
      ]
    });
  }
  if (cursor) {
    filters.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } }
      ]
    });
  }
  const documents = await prisma.document.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(input.status === "ALL" ? {} : { status: input.status }),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.createdByMe ? { createdByUserId: userId } : {}),
      AND: filters
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: { ...DOCUMENT_SELECT, _count: { select: { chunks: true } } }
  });
  const page = documents.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ _count, ...document }) => ({
      ...serializeDocument(document),
      chunkCount: _count.chunks,
      createdByMe: document.createdByUserId === userId,
      capabilities: documentCapabilities(membership.role, userId, document.createdByUserId)
    })),
    nextCursor:
      documents.length > input.limit && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
            query: input.query,
            status: input.status,
            mimeType: input.mimeType ?? null,
            createdByMe: input.createdByMe
          })
        : null
  };
}

export async function getDocument(userId: string, workspaceId: string, documentId: string) {
  const membership = await requireMembership(userId, workspaceId);
  const document = await prisma.document.findUnique({
    where: { id_workspaceId: { id: documentId, workspaceId }, deletedAt: null },
    select: {
      ...DOCUMENT_SELECT,
      _count: { select: { chunks: true } },
      processingRuns: {
        orderBy: { attempt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          attempt: true,
          errorCode: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true
        }
      }
    }
  });
  if (!document) throw documentNotFound();
  const { _count, processingRuns, ...record } = document;
  return {
    ...serializeDocument(record),
    chunkCount: _count.chunks,
    processingRuns: processingRuns.map((run) => ({
      ...run,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString()
    })),
    createdByMe: document.createdByUserId === userId,
    capabilities: documentCapabilities(membership.role, userId, document.createdByUserId)
  };
}

export async function createDocumentDownloadGrant(
  userId: string,
  workspaceId: string,
  documentId: string
) {
  await requireMembership(userId, workspaceId);
  const document = await prisma.document.findUnique({
    where: { id_workspaceId: { id: documentId, workspaceId }, deletedAt: null },
    select: { storageKey: true, name: true, mimeType: true, status: true }
  });
  if (!document || document.status === "UPLOADING" || document.status === "QUARANTINED") {
    throw documentNotFound();
  }
  return getObjectStorage().createDownloadGrant({
    key: document.storageKey,
    filename: document.name,
    contentType: document.mimeType,
    expiresInSeconds: DOCUMENT_DOWNLOAD_GRANT_SECONDS
  });
}

export async function updateDocument(
  userId: string,
  workspaceId: string,
  documentId: string,
  name: string,
  expectedVersion: number,
  requestId: string
) {
  const current = await prisma.document.findUnique({
    where: { id_workspaceId: { id: documentId, workspaceId }, deletedAt: null }
  });
  if (!current) throw documentNotFound();
  await requireDocumentManager(userId, workspaceId, current.createdByUserId);
  const updated = await prisma.document.updateMany({
    where: { id: documentId, workspaceId, deletedAt: null, version: expectedVersion },
    data: { name, version: { increment: 1 } }
  });
  if (updated.count !== 1) throw staleDocument();
  await prisma.auditLog.create({
    data: {
      workspaceId,
      actorUserId: userId,
      actorKind: "USER",
      action: "document.renamed",
      targetType: "Document",
      targetId: documentId,
      outcome: "SUCCEEDED",
      requestId
    }
  });
  return getDocument(userId, workspaceId, documentId);
}

export async function deleteDocument(
  userId: string,
  workspaceId: string,
  documentId: string,
  expectedVersion: number,
  requestId: string
) {
  await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${documentId}, 0))`;
      const membership = await requireMembership(userId, workspaceId, transaction);
      const document = await transaction.document.findUnique({
        where: { id_workspaceId: { id: documentId, workspaceId }, deletedAt: null }
      });
      if (!document) throw documentNotFound();
      requireManager(membership.role, userId, document.createdByUserId);
      if (document.version !== expectedVersion) throw staleDocument();
      const uploaded = document.status !== "UPLOADING";
      const deletedAt = new Date();
      await transaction.document.update({
        where: { id: documentId },
        data: {
          statusBeforeDeletion: document.status,
          status: "DELETING",
          deletedAt,
          purgeAfter: new Date(deletedAt.getTime() + DOCUMENT_RECOVERY_DAYS * 86_400_000),
          version: { increment: 1 }
        }
      });
      await transaction.workspaceStorageQuota.update({
        where: { workspaceId },
        data: uploaded
          ? {
              usedBytes: { decrement: document.sizeBytes },
              documentCount: { decrement: 1 },
              version: { increment: 1 }
            }
          : {
              reservedBytes: { decrement: document.sizeBytes },
              reservedDocumentCount: { decrement: 1 },
              version: { increment: 1 }
            }
      });
      await transaction.auditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          actorKind: "USER",
          action: "document.deletion_scheduled",
          targetType: "Document",
          targetId: documentId,
          outcome: "SUCCEEDED",
          requestId
        }
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

function serializeDocument(document: {
  id: string;
  workspaceId: string;
  createdByUserId: string | null;
  name: string;
  originalFilename: string;
  status: DocumentStatus;
  mimeType: string;
  detectedMimeType: string | null;
  sizeBytes: bigint;
  pageCount: number | null;
  summary: string | null;
  failureCode: string | null;
  activeProcessingRunId: string | null;
  uploadedAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}) {
  return {
    ...document,
    sizeBytes: document.sizeBytes.toString(),
    uploadedAt: document.uploadedAt?.toISOString() ?? null,
    processedAt: document.processedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

async function requireMembership(
  userId: string,
  workspaceId: string,
  client: Pick<typeof prisma, "workspaceMember"> = prisma
) {
  const membership = await client.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
      workspace: { status: "ACTIVE", deletedAt: null }
    },
    select: { role: true }
  });
  if (!membership) throw workspaceNotFound();
  return membership;
}

async function requireDocumentManager(userId: string, workspaceId: string, creator: string | null) {
  const membership = await requireMembership(userId, workspaceId);
  requireManager(membership.role, userId, creator);
}

function requireManager(role: WorkspaceRole, userId: string, creator: string | null) {
  if (role !== "OWNER" && role !== "ADMIN" && creator !== userId) {
    throw new WorkspaceDomainError(
      403,
      "forbidden",
      "Permission denied",
      "Only the document creator or a workspace Admin can manage this document."
    );
  }
}

function documentCapabilities(role: WorkspaceRole, userId: string, creator: string | null) {
  const manage = role === "OWNER" || role === "ADMIN" || creator === userId;
  return { rename: manage, delete: manage, reprocess: manage, download: true, ask: true };
}

function validateUpload(input: {
  filename: string;
  mimeType: SupportedMimeType;
  sizeBytes: number;
}) {
  if (input.sizeBytes > getServerEnvironment().documents.maxBytes) {
    throw new WorkspaceDomainError(
      413,
      "file_too_large",
      "File too large",
      `Documents may not exceed ${getServerEnvironment().documents.maxBytes} bytes.`
    );
  }
  if (/[/\\\u0000-\u001F\u007F]/u.test(input.filename)) {
    throw new WorkspaceDomainError(
      422,
      "invalid_filename",
      "Invalid filename",
      "Provide a filename without path separators."
    );
  }
  const extension = input.filename.split(".").at(-1)?.toLowerCase();
  if (
    !extension ||
    !(SUPPORTED_DOCUMENT_TYPES[input.mimeType] as readonly string[]).includes(extension)
  ) {
    throw new WorkspaceDomainError(
      422,
      "file_type_mismatch",
      "File type mismatch",
      "The filename extension must match the declared PDF, DOCX, or TXT media type."
    );
  }
}

function encodeCursor(value: object) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function decodeCursor(value: string, input: DocumentListInput) {
  try {
    const candidate = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const createdAt =
      typeof candidate.createdAt === "string" ? new Date(candidate.createdAt) : null;
    if (
      !createdAt ||
      !Number.isFinite(createdAt.getTime()) ||
      typeof candidate.id !== "string" ||
      candidate.query !== input.query ||
      candidate.status !== input.status ||
      candidate.mimeType !== (input.mimeType ?? null) ||
      candidate.createdByMe !== input.createdByMe
    )
      throw new Error();
    return { id: candidate.id, createdAt };
  } catch {
    throw new WorkspaceDomainError(
      422,
      "invalid_cursor",
      "Invalid cursor",
      "Restart pagination with the current filters."
    );
  }
}

function deduplicationKey(prefix: string, id: string) {
  return createHash("sha256").update(`${prefix}:${id}`).digest("hex");
}
function quotaExceeded() {
  return new WorkspaceDomainError(
    409,
    "storage_quota_exceeded",
    "Storage quota exceeded",
    "Delete documents or ask a workspace Owner to increase the storage allowance."
  );
}
function uploadMismatch() {
  return new WorkspaceDomainError(
    409,
    "upload_verification_failed",
    "Upload verification failed",
    "The uploaded object does not match the declared file metadata."
  );
}
function invalidDocumentState() {
  return new WorkspaceDomainError(
    409,
    "invalid_document_state",
    "Document state conflict",
    "Reload the document before retrying this operation."
  );
}
function staleDocument() {
  return new WorkspaceDomainError(
    412,
    "stale_version",
    "Document changed",
    "Reload this document before applying the change."
  );
}
function workspaceNotFound() {
  return new WorkspaceDomainError(
    404,
    "not_found",
    "Workspace not found",
    "The requested workspace is not available."
  );
}
function documentNotFound() {
  return new WorkspaceDomainError(
    404,
    "not_found",
    "Document not found",
    "The requested document is not available."
  );
}

export const documentEtag = (id: string, version: number) => `"document:${id}:${version}"`;
