-- Phase 6: durable, branch-aware chat messages and distributed rate-limit accounting.

CREATE TYPE "MessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');
CREATE TYPE "MessageStatus" AS ENUM (
    'PENDING',
    'STREAMING',
    'CANCEL_REQUESTED',
    'COMPLETED',
    'CANCELLED',
    'FAILED'
);

ALTER TABLE "conversations"
ADD COLUMN "next_message_sequence" BIGINT NOT NULL DEFAULT 1;

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "created_by_user_id" TEXT,
    "role" "MessageRole" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "sequence" BIGINT NOT NULL,
    "parent_message_id" UUID,
    "supersedes_message_id" UUID,
    "client_message_id" UUID,
    "client_generation_id" UUID,
    "content" TEXT NOT NULL DEFAULT '',
    "parts" JSONB,
    "provider" VARCHAR(80),
    "model" VARCHAR(120),
    "finish_reason" VARCHAR(80),
    "error_code" VARCHAR(80),
    "started_at" TIMESTAMP(3),
    "cancel_requested_at" TIMESTAMP(3),
    "cancel_requested_by_user_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_client_ids_match_role" CHECK (
        ("client_message_id" IS NULL OR "role" = 'USER')
        AND ("client_generation_id" IS NULL OR "role" = 'ASSISTANT')
    ),
    CONSTRAINT "messages_state_matches_role" CHECK (
        ("role" = 'USER' AND "status" = 'COMPLETED')
        OR ("role" = 'ASSISTANT')
        OR ("role" IN ('SYSTEM', 'TOOL') AND "status" IN ('PENDING', 'COMPLETED', 'FAILED'))
    ),
    CONSTRAINT "messages_cancel_state_complete" CHECK (
        ("cancel_requested_at" IS NULL AND "cancel_requested_by_user_id" IS NULL)
        OR ("cancel_requested_at" IS NOT NULL AND "cancel_requested_by_user_id" IS NOT NULL)
    )
);

CREATE TABLE "ai_rate_limit_buckets" (
    "key" VARCHAR(200) NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_rate_limit_buckets_pkey" PRIMARY KEY ("key", "window_started_at"),
    CONSTRAINT "ai_rate_limit_buckets_count_positive" CHECK ("count" > 0)
);

CREATE UNIQUE INDEX "messages_conversation_id_sequence_key"
ON "messages"("conversation_id", "sequence");

CREATE UNIQUE INDEX "messages_id_workspace_id_key"
ON "messages"("id", "workspace_id");

CREATE UNIQUE INDEX "messages_id_conversation_id_workspace_id_key"
ON "messages"("id", "conversation_id", "workspace_id");

CREATE UNIQUE INDEX "messages_conversation_id_client_message_id_key"
ON "messages"("conversation_id", "client_message_id")
WHERE "client_message_id" IS NOT NULL;

CREATE UNIQUE INDEX "messages_conversation_id_client_generation_id_key"
ON "messages"("conversation_id", "client_generation_id")
WHERE "client_generation_id" IS NOT NULL;

CREATE INDEX "messages_conversation_id_created_at_id_idx"
ON "messages"("conversation_id", "created_at", "id");

CREATE INDEX "messages_workspace_id_created_at_idx"
ON "messages"("workspace_id", "created_at" DESC);

CREATE INDEX "ai_rate_limit_buckets_window_started_at_idx"
ON "ai_rate_limit_buckets"("window_started_at");

ALTER TABLE "messages"
ADD CONSTRAINT "messages_conversation_id_workspace_id_fkey"
FOREIGN KEY ("conversation_id", "workspace_id")
REFERENCES "conversations"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
ADD CONSTRAINT "messages_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "messages"
ADD CONSTRAINT "messages_cancel_requested_by_user_id_fkey"
FOREIGN KEY ("cancel_requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "messages"
ADD CONSTRAINT "messages_parent_message_id_conversation_id_workspace_id_fkey"
FOREIGN KEY ("parent_message_id", "conversation_id", "workspace_id")
REFERENCES "messages"("id", "conversation_id", "workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "messages"
ADD CONSTRAINT "messages_supersedes_message_id_conversation_id_workspace_id_fkey"
FOREIGN KEY ("supersedes_message_id", "conversation_id", "workspace_id")
REFERENCES "messages"("id", "conversation_id", "workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_active_leaf_message_id_fkey"
FOREIGN KEY ("active_leaf_message_id", "id", "workspace_id")
REFERENCES "messages"("id", "conversation_id", "workspace_id")
ON DELETE SET NULL ("active_leaf_message_id") ON UPDATE NO ACTION;

ALTER TABLE "usage_records"
ADD CONSTRAINT "usage_records_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
