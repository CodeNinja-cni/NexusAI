-- Phase 4 adds only the durable resource roots required for truthful dashboard reads.
-- Chat execution, document upload/processing, and AI provider behavior remain later phases.

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM (
    'UPLOADING',
    'UPLOADED',
    'QUEUED',
    'PROCESSING',
    'READY',
    'FAILED',
    'QUARANTINED',
    'DELETING'
);

-- CreateEnum
CREATE TYPE "UsageStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_user_id" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "model_key" VARCHAR(120),
    "system_prompt_version" VARCHAR(80),
    "active_leaf_message_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "purge_started_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_user_id" TEXT,
    "name" VARCHAR(240) NOT NULL,
    "original_filename" VARCHAR(240) NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "status_before_deletion" "DocumentStatus",
    "storage_key" VARCHAR(512) NOT NULL,
    "storage_version_id" VARCHAR(256),
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64),
    "detected_mime_type" VARCHAR(120),
    "page_count" INTEGER,
    "language" VARCHAR(32),
    "summary" TEXT,
    "active_processing_run_id" UUID,
    "failure_code" VARCHAR(80),
    "uploaded_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "purge_started_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documents_size_bytes_nonnegative" CHECK ("size_bytes" >= 0),
    CONSTRAINT "documents_page_count_nonnegative" CHECK ("page_count" IS NULL OR "page_count" >= 0),
    CONSTRAINT "documents_deleting_state_complete" CHECK (
        ("status" = 'DELETING' AND "status_before_deletion" IS NOT NULL)
        OR ("status" <> 'DELETING' AND "status_before_deletion" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "logical_operation_id" UUID NOT NULL,
    "workspace_id" UUID,
    "user_id" TEXT,
    "conversation_id" UUID,
    "message_id" UUID,
    "workflow_execution_id" UUID,
    "request_id" VARCHAR(128) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "provider_request_id" VARCHAR(256),
    "operation" VARCHAR(80) NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "status" "UsageStatus" NOT NULL,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "cached_input_tokens" BIGINT,
    "reasoning_tokens" BIGINT,
    "estimated_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "pricing_version" VARCHAR(80) NOT NULL,
    "latency_ms" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_records_attempt_positive" CHECK ("attempt" > 0),
    CONSTRAINT "usage_records_token_counts_nonnegative" CHECK (
        "input_tokens" >= 0
        AND "output_tokens" >= 0
        AND ("cached_input_tokens" IS NULL OR "cached_input_tokens" >= 0)
        AND ("reasoning_tokens" IS NULL OR "reasoning_tokens" >= 0)
    ),
    CONSTRAINT "usage_records_cost_nonnegative" CHECK ("estimated_cost_micros" >= 0),
    CONSTRAINT "usage_records_latency_nonnegative" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_id_workspace_id_key" ON "conversations"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_deleted_at_last_message_at_id_idx"
ON "conversations"("workspace_id", "deleted_at", "last_message_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "conversations_created_by_user_id_last_message_at_idx"
ON "conversations"("created_by_user_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "documents_id_workspace_id_key" ON "documents"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "documents_workspace_id_deleted_at_created_at_id_idx"
ON "documents"("workspace_id", "deleted_at", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "documents_workspace_id_status_updated_at_idx"
ON "documents"("workspace_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "documents_workspace_id_sha256_idx" ON "documents"("workspace_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_operation_id_key" ON "usage_records"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_logical_operation_id_attempt_key"
ON "usage_records"("logical_operation_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_provider_request_id_key"
ON "usage_records"("provider", "provider_request_id")
WHERE "provider_request_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "usage_records_request_id_occurred_at_idx"
ON "usage_records"("request_id", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_records_user_id_occurred_at_id_idx"
ON "usage_records"("user_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "usage_records_workspace_id_occurred_at_id_idx"
ON "usage_records"("workspace_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "usage_records_provider_model_occurred_at_idx"
ON "usage_records"("provider", "model", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_records_status_occurred_at_idx" ON "usage_records"("status", "occurred_at");

-- AddForeignKey
ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents"
ADD CONSTRAINT "documents_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents"
ADD CONSTRAINT "documents_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records"
ADD CONSTRAINT "usage_records_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records"
ADD CONSTRAINT "usage_records_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records"
ADD CONSTRAINT "usage_records_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
