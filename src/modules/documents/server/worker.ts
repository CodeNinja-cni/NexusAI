import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { getObjectStorage } from "@/platform/storage";
import type { DocumentProcessingJob } from "@/platform/queue/document-queue";
import { createNotification } from "@/modules/notifications/server/service";

import {
  DocumentExtractionError,
  chunkDocument,
  createExtractiveSummary,
  extractDocument,
  type SupportedDocumentMime
} from "./extraction";
import { scanDocument } from "./scanner";

export async function processDocumentJob(
  job: DocumentProcessingJob,
  options: { readonly finalAttempt?: boolean } = {}
) {
  const claimed = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${job.runId}, 0))`;
    const run = await transaction.documentProcessingRun.findUnique({
      where: {
        id_documentId_workspaceId: {
          id: job.runId,
          documentId: job.documentId,
          workspaceId: job.workspaceId
        }
      },
      include: { document: true }
    });
    if (!run) return null;
    if (run.status === "SUCCEEDED") return { alreadyComplete: true as const, run };
    if (run.status === "FAILED" || run.status === "QUARANTINED") return null;
    if (run.document.deletedAt || !["QUEUED", "PROCESSING"].includes(run.document.status)) {
      await transaction.documentProcessingRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorCode: "document_unavailable",
          errorDetailRedacted: "document_unavailable"
        }
      });
      return null;
    }
    const now = new Date();
    await Promise.all([
      transaction.documentProcessingRun.update({
        where: { id: run.id },
        data: { status: "PROCESSING", startedAt: run.startedAt ?? now, queueJobId: job.runId }
      }),
      transaction.document.update({
        where: { id: run.documentId },
        data: { status: "PROCESSING", failureCode: null, version: { increment: 1 } }
      })
    ]);
    return { alreadyComplete: false as const, run };
  });
  if (!claimed || claimed.alreadyComplete) return;

  const { run } = claimed;
  const startedAt = Date.now();
  try {
    const bytes = await getObjectStorage().readObject(
      run.document.storageKey,
      getServerEnvironment().documents.maxBytes
    );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== run.document.sha256) {
      throw new DocumentExtractionError("file_type_mismatch", true);
    }
    const scan = await scanDocument(bytes);
    if (!scan.clean) {
      await finishFailure(job, "malware_detected", true, startedAt, {
        scanner: scan.engine,
        signature: scan.signature ?? "detected"
      });
      return;
    }
    const extracted = await extractDocument(bytes, run.document.mimeType as SupportedDocumentMime);
    const chunks = chunkDocument(extracted);
    const summary = createExtractiveSummary(extracted.text);

    await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${job.runId}, 0))`;
        const current = await transaction.documentProcessingRun.findUnique({
          where: { id: job.runId },
          select: { status: true, document: { select: { deletedAt: true, status: true } } }
        });
        if (!current || current.status === "SUCCEEDED") return;
        if (
          current.document.deletedAt ||
          !["QUEUED", "PROCESSING"].includes(current.document.status)
        ) {
          await transaction.documentProcessingRun.update({
            where: { id: job.runId },
            data: {
              status: "FAILED",
              finishedAt: new Date(),
              errorCode: "document_deleted_during_processing",
              errorDetailRedacted: "document_deleted_during_processing"
            }
          });
          return;
        }
        await transaction.documentChunk.deleteMany({ where: { processingRunId: job.runId } });
        await transaction.documentChunk.createMany({
          data: chunks.map((chunk) => ({
            workspaceId: job.workspaceId,
            documentId: job.documentId,
            processingRunId: job.runId,
            ordinal: chunk.ordinal,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
            contentSha256: chunk.contentSha256
          }))
        });
        const now = new Date();
        await transaction.documentProcessingRun.update({
          where: { id: job.runId },
          data: {
            status: "SUCCEEDED",
            extractor: extracted.extractor,
            extractorVersion: "1",
            chunkerVersion: "character-v1",
            finishedAt: now,
            errorCode: null,
            errorDetailRedacted: null,
            metrics: {
              bytes: bytes.byteLength,
              characters: extracted.text.length,
              chunks: chunks.length,
              durationMs: Date.now() - startedAt,
              scanner: scan.engine
            }
          }
        });
        await transaction.document.update({
          where: { id: job.documentId },
          data: {
            status: "READY",
            detectedMimeType: extracted.detectedMimeType,
            pageCount: extracted.pageCount,
            summary,
            activeProcessingRunId: job.runId,
            failureCode: null,
            processedAt: now,
            version: { increment: 1 }
          }
        });
        if (run.document.createdByUserId) {
          await createNotification(transaction, {
            userId: run.document.createdByUserId,
            workspaceId: job.workspaceId,
            type: "DOCUMENT_PROCESSING",
            title: "Document ready",
            body: `${run.document.name} finished processing and is ready to search or question.`,
            actionUrl: `/documents/${job.documentId}`,
            data: { documentId: job.documentId, status: "READY" },
            eventKey: `document-processing:${job.runId}:ready`
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    const extractionError = error instanceof DocumentExtractionError ? error : null;
    if (!extractionError && options.finalAttempt === false) {
      await resetForRetry(job);
      throw error;
    }
    await finishFailure(
      job,
      extractionError?.code ?? "document_processing_failed",
      extractionError?.quarantine ?? false,
      startedAt
    );
    if (!extractionError) throw error;
  }
}

async function resetForRetry(job: DocumentProcessingJob) {
  await prisma.$transaction([
    prisma.documentProcessingRun.updateMany({
      where: { id: job.runId, status: "PROCESSING" },
      data: {
        status: "QUEUED",
        errorCode: "document_processing_retryable",
        errorDetailRedacted: "document_processing_retryable"
      }
    }),
    prisma.document.updateMany({
      where: { id: job.documentId, workspaceId: job.workspaceId, deletedAt: null },
      data: {
        status: "QUEUED",
        failureCode: "document_processing_retryable",
        version: { increment: 1 }
      }
    })
  ]);
}

async function finishFailure(
  job: DocumentProcessingJob,
  errorCode: string,
  quarantine: boolean,
  startedAt: number,
  metrics: Record<string, unknown> = {}
) {
  const status = quarantine ? "QUARANTINED" : "FAILED";
  await prisma.$transaction(async (transaction) => {
    const document = await transaction.document.findFirst({
      where: { id: job.documentId, workspaceId: job.workspaceId, deletedAt: null },
      select: { name: true, createdByUserId: true }
    });
    const runUpdate = await transaction.documentProcessingRun.updateMany({
      where: { id: job.runId, status: { in: ["QUEUED", "PROCESSING"] } },
      data: {
        status,
        finishedAt: new Date(),
        errorCode,
        errorDetailRedacted: errorCode,
        metrics: { ...metrics, durationMs: Date.now() - startedAt }
      }
    });
    if (runUpdate.count !== 1 || !document) return;
    await transaction.document.updateMany({
      where: { id: job.documentId, workspaceId: job.workspaceId, deletedAt: null },
      data: { status, failureCode: errorCode, processedAt: new Date(), version: { increment: 1 } }
    });
    if (document.createdByUserId) {
      await createNotification(transaction, {
        userId: document.createdByUserId,
        workspaceId: job.workspaceId,
        type: "DOCUMENT_PROCESSING",
        title: quarantine ? "Document quarantined" : "Document processing failed",
        body: quarantine
          ? `${document.name} could not be admitted to the workspace. Review its status before uploading a replacement.`
          : `${document.name} could not be processed. Open the document record for a safe status and next step.`,
        actionUrl: `/documents/${job.documentId}`,
        data: { documentId: job.documentId, status },
        eventKey: `document-processing:${job.runId}:${status.toLowerCase()}`
      });
    }
  });
}
