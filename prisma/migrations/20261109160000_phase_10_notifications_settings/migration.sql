-- Phase 10: user notifications, persistent settings support, and governed account deletion.

CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'CANCELLED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" TEXT,
    "subject_id_hash" CHAR(64) NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "cancellation_token_digest" CHAR(64),
    "cancellation_expires_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_code" VARCHAR(80),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "lease_expires_at" TIMESTAMP(3),
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_deletion_requests_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "account_deletion_requests_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
    CONSTRAINT "account_deletion_requests_schedule_valid" CHECK ("scheduled_for" >= "requested_at"),
    CONSTRAINT "account_deletion_requests_cancellation_complete" CHECK (
        ("cancellation_token_digest" IS NULL AND "cancellation_expires_at" IS NULL)
        OR ("cancellation_token_digest" IS NOT NULL AND "cancellation_expires_at" IS NOT NULL)
    ),
    CONSTRAINT "account_deletion_requests_active_user" CHECK (
        "status" IN ('COMPLETED', 'CANCELLED') OR "user_id" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "account_deletion_requests_cancellation_token_digest_key"
ON "account_deletion_requests"("cancellation_token_digest");
CREATE UNIQUE INDEX "account_deletion_requests_one_active_per_user"
ON "account_deletion_requests"("user_id")
WHERE "status" IN ('PENDING', 'RUNNING', 'FAILED');
CREATE INDEX "account_deletion_requests_status_scheduled_for_idx"
ON "account_deletion_requests"("status", "scheduled_for");
CREATE INDEX "account_deletion_requests_status_next_attempt_at_idx"
ON "account_deletion_requests"("status", "next_attempt_at");
CREATE INDEX "account_deletion_requests_user_id_created_at_idx"
ON "account_deletion_requests"("user_id", "created_at" DESC);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" UUID,
    "type" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "action_url" VARCHAR(512),
    "data" JSONB NOT NULL DEFAULT '{}',
    "deduplication_key" CHAR(64),
    "read_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notifications_type_format" CHECK ("type" ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT "notifications_action_url_internal" CHECK (
        "action_url" IS NULL OR ("action_url" LIKE '/%' AND "action_url" NOT LIKE '//%')
    )
);

CREATE UNIQUE INDEX "notifications_deduplication_key_key"
ON "notifications"("deduplication_key");
CREATE INDEX "notifications_user_read_created_idx"
ON "notifications"("user_id", "read_at", "created_at" DESC, "id" DESC);
CREATE INDEX "notifications_user_created_idx"
ON "notifications"("user_id", "created_at" DESC, "id" DESC);
CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");
