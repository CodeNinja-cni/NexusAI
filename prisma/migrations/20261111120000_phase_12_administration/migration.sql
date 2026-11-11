ALTER TABLE "users"
  ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sessions"
  ADD COLUMN "mfa_verified_at" TIMESTAMP(3);

CREATE TABLE "two_factors" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "backup_codes" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failed_verification_count" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMP(3),
  CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "two_factors_user_id_key" ON "two_factors"("user_id");
CREATE INDEX "two_factors_user_id_idx" ON "two_factors"("user_id");

ALTER TABLE "two_factors"
  ADD CONSTRAINT "two_factors_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "platform_settings" (
  "key" VARCHAR(80) NOT NULL,
  "value" JSONB NOT NULL,
  "schema_version" VARCHAR(40) NOT NULL,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "platform_settings_version_check" CHECK ("version" > 0)
);

CREATE INDEX "platform_settings_updated_by_user_id_updated_at_idx"
  ON "platform_settings"("updated_by_user_id", "updated_at" DESC);

ALTER TABLE "platform_settings"
  ADD CONSTRAINT "platform_settings_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "admin_rate_limit_buckets" (
  "key" VARCHAR(200) NOT NULL,
  "window_started_at" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_rate_limit_buckets_pkey" PRIMARY KEY ("key", "window_started_at"),
  CONSTRAINT "admin_rate_limit_buckets_count_check" CHECK ("count" >= 0)
);

CREATE INDEX "admin_rate_limit_buckets_window_started_at_idx"
  ON "admin_rate_limit_buckets"("window_started_at");

INSERT INTO "platform_settings" ("key", "value", "schema_version", "updated_at")
VALUES
  ('user_registration', '{"mode":"OPEN"}'::jsonb, '1', CURRENT_TIMESTAMP),
  ('maintenance_notice', '{"enabled":false,"message":""}'::jsonb, '1', CURRENT_TIMESTAMP),
  ('admin_operations', '{"failedJobAlertThreshold":5,"defaultUsageRangeDays":30}'::jsonb, '1', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
