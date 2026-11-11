-- Phase 7: tenant-scoped conversation and message full-text search plus purge scheduling.

CREATE INDEX "conversations_title_search_idx"
ON "conversations"
USING GIN (to_tsvector('simple', coalesce("title", '')));

CREATE INDEX "messages_content_search_idx"
ON "messages"
USING GIN (to_tsvector('simple', coalesce("content", '')))
WHERE "role" IN ('USER', 'ASSISTANT');

CREATE INDEX "conversations_pending_purge_idx"
ON "conversations"("purge_after", "id")
WHERE "deleted_at" IS NOT NULL AND "purge_started_at" IS NULL;
