-- Phase 9: immutable provider usage, effective-dated pricing, and atomic monthly quotas.

CREATE TYPE "UsageSource" AS ENUM ('PROVIDER_REPORTED', 'DEVELOPMENT_ESTIMATE', 'UNAVAILABLE');
CREATE TYPE "UsagePricingStatus" AS ENUM ('PRICED', 'UNPRICED');
CREATE TYPE "UsageReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED');

CREATE TABLE "ai_model_prices" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "version" VARCHAR(80) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "input_price_micros_per_million" BIGINT NOT NULL,
    "cached_input_price_micros_per_million" BIGINT,
    "output_price_micros_per_million" BIGINT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "source_url" VARCHAR(2048) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_model_prices_rates_nonnegative" CHECK (
        "input_price_micros_per_million" >= 0
        AND "output_price_micros_per_million" >= 0
        AND ("cached_input_price_micros_per_million" IS NULL OR "cached_input_price_micros_per_million" >= 0)
    ),
    CONSTRAINT "ai_model_prices_window_valid" CHECK (
        "effective_to" IS NULL OR "effective_to" > "effective_from"
    ),
    CONSTRAINT "ai_model_prices_currency_valid" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "ai_model_prices_version_key" ON "ai_model_prices"("version");
CREATE UNIQUE INDEX "ai_model_prices_provider_model_effective_from_key"
ON "ai_model_prices"("provider", "model", "effective_from");
CREATE INDEX "ai_model_prices_provider_model_effective_from_idx"
ON "ai_model_prices"("provider", "model", "effective_from" DESC);

ALTER TABLE "usage_records"
ADD COLUMN "usage_source" "UsageSource",
ADD COLUMN "pricing_status" "UsagePricingStatus",
ADD COLUMN "model_price_id" UUID,
ADD COLUMN "input_price_micros_per_million" BIGINT,
ADD COLUMN "cached_input_price_micros_per_million" BIGINT,
ADD COLUMN "output_price_micros_per_million" BIGINT;

UPDATE "usage_records"
SET "usage_source" = CASE
    WHEN "provider" = 'mock' THEN 'DEVELOPMENT_ESTIMATE'::"UsageSource"
    WHEN COALESCE("metadata"->>'usageSource', '') = 'provider_reported' THEN 'PROVIDER_REPORTED'::"UsageSource"
    WHEN "input_tokens" > 0 OR "output_tokens" > 0 THEN 'PROVIDER_REPORTED'::"UsageSource"
    ELSE 'UNAVAILABLE'::"UsageSource"
END,
"pricing_status" = 'UNPRICED'::"UsagePricingStatus";

ALTER TABLE "usage_records"
ALTER COLUMN "usage_source" SET DEFAULT 'UNAVAILABLE',
ALTER COLUMN "usage_source" SET NOT NULL,
ALTER COLUMN "pricing_status" SET DEFAULT 'UNPRICED',
ALTER COLUMN "pricing_status" SET NOT NULL,
ADD CONSTRAINT "usage_records_model_price_id_fkey"
    FOREIGN KEY ("model_price_id") REFERENCES "ai_model_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "usage_records_price_snapshots_nonnegative" CHECK (
    ("input_price_micros_per_million" IS NULL OR "input_price_micros_per_million" >= 0)
    AND ("cached_input_price_micros_per_million" IS NULL OR "cached_input_price_micros_per_million" >= 0)
    AND ("output_price_micros_per_million" IS NULL OR "output_price_micros_per_million" >= 0)
),
ADD CONSTRAINT "usage_records_pricing_snapshot_complete" CHECK (
    ("pricing_status" = 'UNPRICED' AND "model_price_id" IS NULL)
    OR (
        "pricing_status" = 'PRICED'
        AND "input_price_micros_per_million" IS NOT NULL
        AND "output_price_micros_per_million" IS NOT NULL
    )
);

CREATE INDEX "usage_records_pricing_status_occurred_at_idx"
ON "usage_records"("pricing_status", "occurred_at");

CREATE TABLE "workspace_usage_policies" (
    "workspace_id" UUID NOT NULL,
    "request_limit" BIGINT,
    "input_token_limit" BIGINT,
    "output_token_limit" BIGINT,
    "cost_limit_micros" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workspace_usage_policies_pkey" PRIMARY KEY ("workspace_id"),
    CONSTRAINT "workspace_usage_policies_limits_nonnegative" CHECK (
        ("request_limit" IS NULL OR "request_limit" >= 0)
        AND ("input_token_limit" IS NULL OR "input_token_limit" >= 0)
        AND ("output_token_limit" IS NULL OR "output_token_limit" >= 0)
        AND ("cost_limit_micros" IS NULL OR "cost_limit_micros" >= 0)
    ),
    CONSTRAINT "workspace_usage_policies_currency_valid" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "workspace_usage_policies_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "workspace_usage_policies" ("workspace_id", "updated_at")
SELECT "id", CURRENT_TIMESTAMP FROM "workspaces";

CREATE TABLE "usage_quota_periods" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "request_limit" BIGINT,
    "input_token_limit" BIGINT,
    "output_token_limit" BIGINT,
    "cost_limit_micros" BIGINT,
    "consumed_requests" BIGINT NOT NULL DEFAULT 0,
    "consumed_input_tokens" BIGINT NOT NULL DEFAULT 0,
    "consumed_output_tokens" BIGINT NOT NULL DEFAULT 0,
    "consumed_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "reserved_requests" BIGINT NOT NULL DEFAULT 0,
    "reserved_input_tokens" BIGINT NOT NULL DEFAULT 0,
    "reserved_output_tokens" BIGINT NOT NULL DEFAULT 0,
    "reserved_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "usage_quota_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_quota_periods_window_valid" CHECK ("period_end" > "period_start"),
    CONSTRAINT "usage_quota_periods_limits_nonnegative" CHECK (
        ("request_limit" IS NULL OR "request_limit" >= 0)
        AND ("input_token_limit" IS NULL OR "input_token_limit" >= 0)
        AND ("output_token_limit" IS NULL OR "output_token_limit" >= 0)
        AND ("cost_limit_micros" IS NULL OR "cost_limit_micros" >= 0)
    ),
    CONSTRAINT "usage_quota_periods_counters_nonnegative" CHECK (
        "consumed_requests" >= 0 AND "consumed_input_tokens" >= 0
        AND "consumed_output_tokens" >= 0 AND "consumed_cost_micros" >= 0
        AND "reserved_requests" >= 0 AND "reserved_input_tokens" >= 0
        AND "reserved_output_tokens" >= 0 AND "reserved_cost_micros" >= 0
    ),
    CONSTRAINT "usage_quota_periods_currency_valid" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "usage_quota_periods_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_quota_periods_workspace_window_key"
ON "usage_quota_periods"("workspace_id", "period_start", "period_end");
CREATE INDEX "usage_quota_periods_period_end_idx" ON "usage_quota_periods"("period_end");

CREATE TABLE "usage_reservations" (
    "id" UUID NOT NULL,
    "quota_period_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" TEXT,
    "model_price_id" UUID,
    "logical_operation_id" UUID NOT NULL,
    "status" "UsageReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reserved_requests" BIGINT NOT NULL DEFAULT 1,
    "reserved_input_tokens" BIGINT NOT NULL,
    "reserved_output_tokens" BIGINT NOT NULL,
    "reserved_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "actual_input_tokens" BIGINT,
    "actual_output_tokens" BIGINT,
    "actual_cost_micros" BIGINT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_reservations_values_nonnegative" CHECK (
        "reserved_requests" >= 0 AND "reserved_input_tokens" >= 0
        AND "reserved_output_tokens" >= 0 AND "reserved_cost_micros" >= 0
        AND ("actual_input_tokens" IS NULL OR "actual_input_tokens" >= 0)
        AND ("actual_output_tokens" IS NULL OR "actual_output_tokens" >= 0)
        AND ("actual_cost_micros" IS NULL OR "actual_cost_micros" >= 0)
    ),
    CONSTRAINT "usage_reservations_quota_period_id_fkey"
        FOREIGN KEY ("quota_period_id") REFERENCES "usage_quota_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "usage_reservations_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "usage_reservations_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "usage_reservations_model_price_id_fkey"
        FOREIGN KEY ("model_price_id") REFERENCES "ai_model_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_reservations_logical_operation_id_key"
ON "usage_reservations"("logical_operation_id");
CREATE INDEX "usage_reservations_period_status_expiry_idx"
ON "usage_reservations"("quota_period_id", "status", "expires_at");
CREATE INDEX "usage_reservations_workspace_created_at_idx"
ON "usage_reservations"("workspace_id", "created_at" DESC);
