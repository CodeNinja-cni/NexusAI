-- Phase 8: private document processing, immutable chunks, citations, and PostgreSQL FTS.

CREATE TYPE "DocumentProcessingStatus" AS ENUM (
    'QUEUED',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'QUARANTINED'
);

CREATE TABLE "document_processing_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "status" "DocumentProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL,
    "extractor" VARCHAR(80) NOT NULL,
    "extractor_version" VARCHAR(40) NOT NULL,
    "chunker_version" VARCHAR(40) NOT NULL,
    "queue_job_id" VARCHAR(128),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error_code" VARCHAR(80),
    "error_detail_redacted" VARCHAR(160),
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_processing_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_processing_runs_attempt_positive" CHECK ("attempt" > 0)
);

CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "processing_run_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "char_start" INTEGER,
    "char_end" INTEGER,
    "content_sha256" CHAR(64) NOT NULL,
    "language" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_chunks_bounds_valid" CHECK (
        "ordinal" >= 0
        AND "token_count" >= 0
        AND ("page_start" IS NULL OR "page_start" > 0)
        AND ("page_end" IS NULL OR "page_end" >= "page_start")
        AND ("char_start" IS NULL OR "char_start" >= 0)
        AND ("char_end" IS NULL OR "char_end" >= "char_start")
    )
);

CREATE TABLE "conversation_documents" (
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "attached_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_documents_pkey" PRIMARY KEY ("conversation_id", "document_id")
);

CREATE TABLE "message_citations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "document_chunk_id" UUID,
    "document_id_snapshot" UUID NOT NULL,
    "chunk_ordinal_snapshot" INTEGER NOT NULL,
    "chunk_content_sha256" CHAR(64) NOT NULL,
    "excerpt" VARCHAR(800) NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "label" VARCHAR(240),
    "relevance_score" DECIMAL(8,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_citations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_citations_ordinal_positive" CHECK ("ordinal" > 0),
    CONSTRAINT "message_citations_pages_valid" CHECK (
        ("page_start" IS NULL OR "page_start" > 0)
        AND ("page_end" IS NULL OR "page_end" >= "page_start")
    )
);

CREATE UNIQUE INDEX "documents_active_processing_run_id_id_workspace_id_key"
ON "documents"("active_processing_run_id", "id", "workspace_id");

CREATE UNIQUE INDEX "document_processing_runs_document_id_attempt_key"
ON "document_processing_runs"("document_id", "attempt");
CREATE UNIQUE INDEX "document_processing_runs_id_document_id_workspace_id_key"
ON "document_processing_runs"("id", "document_id", "workspace_id");
CREATE UNIQUE INDEX "document_processing_runs_queue_job_id_key"
ON "document_processing_runs"("queue_job_id");
CREATE INDEX "document_processing_runs_status_created_at_idx"
ON "document_processing_runs"("status", "created_at");
CREATE INDEX "document_processing_runs_workspace_id_document_id_attempt_idx"
ON "document_processing_runs"("workspace_id", "document_id", "attempt" DESC);

CREATE UNIQUE INDEX "document_chunks_document_id_processing_run_id_ordinal_key"
ON "document_chunks"("document_id", "processing_run_id", "ordinal");
CREATE UNIQUE INDEX "document_chunks_id_workspace_id_key"
ON "document_chunks"("id", "workspace_id");
CREATE INDEX "document_chunks_workspace_id_document_id_processing_run_id_ordinal_idx"
ON "document_chunks"("workspace_id", "document_id", "processing_run_id", "ordinal");
CREATE INDEX "document_chunks_content_sha256_idx" ON "document_chunks"("content_sha256");
CREATE INDEX "document_chunks_search_idx" ON "document_chunks" USING GIN ("search_vector");

CREATE INDEX "conversation_documents_workspace_id_document_id_idx"
ON "conversation_documents"("workspace_id", "document_id");

CREATE UNIQUE INDEX "message_citations_message_id_ordinal_key"
ON "message_citations"("message_id", "ordinal");
CREATE INDEX "message_citations_document_chunk_id_idx" ON "message_citations"("document_chunk_id");
CREATE INDEX "message_citations_document_id_snapshot_idx" ON "message_citations"("document_id_snapshot");

CREATE INDEX "documents_metadata_search_idx"
ON "documents" USING GIN (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("summary", '')));

CREATE INDEX "documents_pending_purge_idx"
ON "documents"("purge_after", "id")
WHERE "deleted_at" IS NOT NULL AND "purge_started_at" IS NULL;

ALTER TABLE "document_processing_runs"
ADD CONSTRAINT "document_processing_runs_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_processing_runs"
ADD CONSTRAINT "document_processing_runs_document_id_workspace_id_fkey"
FOREIGN KEY ("document_id", "workspace_id")
REFERENCES "documents"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks"
ADD CONSTRAINT "document_chunks_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks"
ADD CONSTRAINT "document_chunks_document_id_workspace_id_fkey"
FOREIGN KEY ("document_id", "workspace_id")
REFERENCES "documents"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks"
ADD CONSTRAINT "document_chunks_processing_run_id_document_id_workspace_id_fkey"
FOREIGN KEY ("processing_run_id", "document_id", "workspace_id")
REFERENCES "document_processing_runs"("id", "document_id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "conversation_documents"
ADD CONSTRAINT "conversation_documents_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_documents"
ADD CONSTRAINT "conversation_documents_conversation_id_workspace_id_fkey"
FOREIGN KEY ("conversation_id", "workspace_id")
REFERENCES "conversations"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_documents"
ADD CONSTRAINT "conversation_documents_document_id_workspace_id_fkey"
FOREIGN KEY ("document_id", "workspace_id")
REFERENCES "documents"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_documents"
ADD CONSTRAINT "conversation_documents_attached_by_user_id_fkey"
FOREIGN KEY ("attached_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_citations"
ADD CONSTRAINT "message_citations_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_citations"
ADD CONSTRAINT "message_citations_message_id_workspace_id_fkey"
FOREIGN KEY ("message_id", "workspace_id")
REFERENCES "messages"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_citations"
ADD CONSTRAINT "message_citations_document_chunk_id_fkey"
FOREIGN KEY ("document_chunk_id") REFERENCES "document_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents"
ADD CONSTRAINT "documents_active_processing_run_id_id_workspace_id_fkey"
FOREIGN KEY ("active_processing_run_id", "id", "workspace_id")
REFERENCES "document_processing_runs"("id", "document_id", "workspace_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
