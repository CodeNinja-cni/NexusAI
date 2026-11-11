-- Phase 11: immutable, allow-listed workflow definitions and controlled executions.

CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "WorkflowExecutionStatus" AS ENUM (
    'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'TIMED_OUT'
);
CREATE TYPE "WorkflowLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_user_id" TEXT,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "active_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "purge_started_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflows_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflows_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflows_recovery_fields" CHECK (
        ("deleted_at" IS NULL AND "purge_after" IS NULL AND "purge_started_at" IS NULL)
        OR ("deleted_at" IS NOT NULL AND "purge_after" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "workflows_id_workspace_id_key" ON "workflows"("id", "workspace_id");
CREATE UNIQUE INDEX "workflows_workspace_name_live_key"
ON "workflows"("workspace_id", lower("name")) WHERE "deleted_at" IS NULL;
CREATE INDEX "workflows_workspace_deleted_updated_idx"
ON "workflows"("workspace_id", "deleted_at", "updated_at" DESC, "id" DESC);
CREATE INDEX "workflows_creator_created_idx"
ON "workflows"("created_by_user_id", "created_at" DESC);

CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "schema_version" VARCHAR(40) NOT NULL,
    "definition" JSONB NOT NULL,
    "created_by_user_id" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "definition_sha256" CHAR(64) NOT NULL,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_versions_workflow_scope_fkey"
        FOREIGN KEY ("workflow_id", "workspace_id") REFERENCES "workflows"("id", "workspace_id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_versions_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflow_versions_number_positive" CHECK ("version_number" > 0),
    CONSTRAINT "workflow_versions_definition_bounded" CHECK (pg_column_size("definition") <= 1048576),
    CONSTRAINT "workflow_versions_digest_format" CHECK ("definition_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "workflow_versions_workflow_number_key"
ON "workflow_versions"("workflow_id", "version_number");
CREATE UNIQUE INDEX "workflow_versions_id_workspace_id_key"
ON "workflow_versions"("id", "workspace_id");
CREATE UNIQUE INDEX "workflow_versions_id_workflow_workspace_key"
ON "workflow_versions"("id", "workflow_id", "workspace_id");
CREATE INDEX "workflow_versions_workflow_digest_idx"
ON "workflow_versions"("workflow_id", "definition_sha256");
CREATE INDEX "workflow_versions_workspace_workflow_number_idx"
ON "workflow_versions"("workspace_id", "workflow_id", "version_number" DESC);

ALTER TABLE "workflows"
ADD CONSTRAINT "workflows_active_version_id_fkey"
FOREIGN KEY ("active_version_id") REFERENCES "workflow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION assert_workflow_active_version_scope()
RETURNS trigger AS $$
BEGIN
    IF NEW."active_version_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "workflow_versions" v
        WHERE v."id" = NEW."active_version_id"
          AND v."workflow_id" = NEW."id"
          AND v."workspace_id" = NEW."workspace_id"
    ) THEN
        RAISE EXCEPTION 'workflow active version scope mismatch' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "workflows_active_version_scope"
AFTER INSERT OR UPDATE OF "active_version_id", "workspace_id" ON "workflows"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION assert_workflow_active_version_scope();

CREATE TABLE "workflow_executions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "workflow_version_id" UUID NOT NULL,
    "requested_by_user_id" TEXT,
    "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL,
    "input_sha256" CHAR(64) NOT NULL,
    "output" JSONB,
    "error_code" VARCHAR(80),
    "error_detail_redacted" VARCHAR(240),
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "queue_job_id" VARCHAR(128),
    "run_number" INTEGER NOT NULL DEFAULT 1,
    "step_limit" INTEGER NOT NULL,
    "timeout_ms" INTEGER NOT NULL,
    "output_character_limit" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "cancel_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_executions_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_executions_workflow_scope_fkey"
        FOREIGN KEY ("workflow_id", "workspace_id") REFERENCES "workflows"("id", "workspace_id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_executions_version_scope_fkey"
        FOREIGN KEY ("workflow_version_id", "workflow_id", "workspace_id")
        REFERENCES "workflow_versions"("id", "workflow_id", "workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "workflow_executions_requester_fkey"
        FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflow_executions_limits" CHECK (
        "run_number" > 0 AND "step_limit" BETWEEN 1 AND 100
        AND "timeout_ms" BETWEEN 1000 AND 600000
        AND "output_character_limit" BETWEEN 1 AND 1000000
    ),
    CONSTRAINT "workflow_executions_input_bounded" CHECK (pg_column_size("input") <= 65536),
    CONSTRAINT "workflow_executions_output_bounded" CHECK ("output" IS NULL OR pg_column_size("output") <= 1048576),
    CONSTRAINT "workflow_executions_input_digest_format" CHECK ("input_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "workflow_executions_key_digest_format" CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "workflow_executions_idempotency_key_hash_key"
ON "workflow_executions"("idempotency_key_hash");
CREATE UNIQUE INDEX "workflow_executions_queue_job_id_key"
ON "workflow_executions"("queue_job_id");
CREATE UNIQUE INDEX "workflow_executions_id_workspace_id_key"
ON "workflow_executions"("id", "workspace_id");
CREATE UNIQUE INDEX "workflow_executions_id_workflow_workspace_key"
ON "workflow_executions"("id", "workflow_id", "workspace_id");
CREATE INDEX "workflow_executions_workspace_workflow_created_idx"
ON "workflow_executions"("workspace_id", "workflow_id", "created_at" DESC, "id" DESC);
CREATE INDEX "workflow_executions_status_created_idx"
ON "workflow_executions"("status", "created_at");
CREATE INDEX "workflow_executions_requester_created_idx"
ON "workflow_executions"("requested_by_user_id", "created_at" DESC);

CREATE TABLE "workflow_execution_logs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "node_id" VARCHAR(80),
    "level" "WorkflowLogLevel" NOT NULL DEFAULT 'INFO',
    "event" VARCHAR(80) NOT NULL,
    "message" VARCHAR(240) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_execution_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_execution_logs_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_execution_logs_execution_scope_fkey"
        FOREIGN KEY ("execution_id", "workspace_id") REFERENCES "workflow_executions"("id", "workspace_id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_execution_logs_sequence_positive" CHECK ("sequence" > 0),
    CONSTRAINT "workflow_execution_logs_data_bounded" CHECK (pg_column_size("data") <= 16384)
);

CREATE UNIQUE INDEX "workflow_execution_logs_execution_sequence_key"
ON "workflow_execution_logs"("execution_id", "sequence");
CREATE INDEX "workflow_execution_logs_workspace_execution_sequence_idx"
ON "workflow_execution_logs"("workspace_id", "execution_id", "sequence");
CREATE INDEX "workflow_execution_logs_created_at_idx"
ON "workflow_execution_logs"("created_at");

ALTER TABLE "usage_records"
ADD CONSTRAINT "usage_records_workflow_execution_id_fkey"
FOREIGN KEY ("workflow_execution_id") REFERENCES "workflow_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "usage_records_workflow_execution_idx"
ON "usage_records"("workflow_execution_id", "occurred_at");
