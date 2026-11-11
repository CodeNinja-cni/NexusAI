import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { WorkspaceDomainError } from "@/modules/workspaces/server/route-support";
import { prisma } from "@/platform/database/prisma";

export interface RetrievedDocumentChunk {
  readonly id: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly ordinal: number;
  readonly content: string;
  readonly contentSha256: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly score: number;
}

export interface DocumentRetriever {
  retrieve(input: {
    readonly workspaceId: string;
    readonly documentIds: readonly string[];
    readonly query: string;
    readonly limit: number;
  }): Promise<readonly RetrievedDocumentChunk[]>;
}

/** The chat layer depends on this port, so a pgvector retriever can replace it later. */
export class PostgresFullTextDocumentRetriever implements DocumentRetriever {
  async retrieve(input: {
    workspaceId: string;
    documentIds: readonly string[];
    query: string;
    limit: number;
  }) {
    if (input.documentIds.length === 0) return [];
    const normalizedQuery = input.query
      .replace(/[\u0000-\u001F\u007F]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 2_000);
    const ready = await prisma.document.count({
      where: {
        workspaceId: input.workspaceId,
        id: { in: [...input.documentIds] },
        status: "READY",
        deletedAt: null
      }
    });
    if (ready !== new Set(input.documentIds).size) {
      throw new WorkspaceDomainError(
        422,
        "document_not_ready",
        "Document not ready",
        "Every selected document must be available and fully processed."
      );
    }

    const rows = normalizedQuery
      ? await prisma.$queryRaw<RetrievedDocumentChunk[]>(Prisma.sql`
      WITH requested AS (
        SELECT websearch_to_tsquery('simple', ${normalizedQuery}) AS query
      )
      SELECT
        chunk."id",
        chunk."document_id" AS "documentId",
        document."name" AS "documentName",
        chunk."ordinal",
        chunk."content",
        chunk."content_sha256" AS "contentSha256",
        chunk."page_start" AS "pageStart",
        chunk."page_end" AS "pageEnd",
        ts_rank_cd(chunk."search_vector", requested.query)::double precision AS "score"
      FROM "document_chunks" chunk
      JOIN "documents" document
        ON document."id" = chunk."document_id"
       AND document."workspace_id" = chunk."workspace_id"
      CROSS JOIN requested
      WHERE chunk."workspace_id" = CAST(${input.workspaceId} AS uuid)
        AND chunk."document_id" IN (${Prisma.join(input.documentIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`))})
        AND chunk."processing_run_id" = document."active_processing_run_id"
        AND document."status" = 'READY'
        AND document."deleted_at" IS NULL
        AND chunk."search_vector" @@ requested.query
      ORDER BY "score" DESC, chunk."document_id", chunk."ordinal"
      LIMIT ${input.limit}
    `)
      : [];
    if (rows.length > 0) return rows;

    return prisma.$queryRaw<RetrievedDocumentChunk[]>(Prisma.sql`
      SELECT
        chunk."id",
        chunk."document_id" AS "documentId",
        document."name" AS "documentName",
        chunk."ordinal",
        chunk."content",
        chunk."content_sha256" AS "contentSha256",
        chunk."page_start" AS "pageStart",
        chunk."page_end" AS "pageEnd",
        0::double precision AS "score"
      FROM "document_chunks" chunk
      JOIN "documents" document
        ON document."id" = chunk."document_id"
       AND document."workspace_id" = chunk."workspace_id"
      WHERE chunk."workspace_id" = CAST(${input.workspaceId} AS uuid)
        AND chunk."document_id" IN (${Prisma.join(input.documentIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`))})
        AND chunk."processing_run_id" = document."active_processing_run_id"
        AND document."status" = 'READY'
        AND document."deleted_at" IS NULL
      ORDER BY chunk."document_id", chunk."ordinal"
      LIMIT ${input.limit}
    `);
  }
}

export const documentRetriever: DocumentRetriever = new PostgresFullTextDocumentRetriever();
