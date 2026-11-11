-- Phase 5 turns the existing workspace/membership roots into an enforced lifecycle.
-- These checks complement the serializable service transactions and partial unique indexes.

ALTER TABLE "workspaces"
ADD CONSTRAINT "workspaces_deletion_state_complete"
CHECK (
  (
    "status" = 'ACTIVE'
    AND "deleted_at" IS NULL
    AND "purge_after" IS NULL
    AND "purge_started_at" IS NULL
  )
  OR (
    "status" = 'PENDING_DELETION'
    AND "deleted_at" IS NOT NULL
    AND "purge_after" IS NOT NULL
    AND "purge_after" > "deleted_at"
  )
);

ALTER TABLE "workspace_invitations"
ADD CONSTRAINT "workspace_invitations_closure_state_complete"
CHECK (
  ("status" = 'PENDING' AND "closed_at" IS NULL AND "accepted_at" IS NULL AND "accepted_by_user_id" IS NULL)
  OR
  ("status" = 'ACCEPTED' AND "closed_at" IS NOT NULL AND "accepted_at" IS NOT NULL AND "accepted_by_user_id" IS NOT NULL)
  OR
  ("status" IN ('REVOKED', 'EXPIRED') AND "closed_at" IS NOT NULL AND "accepted_at" IS NULL AND "accepted_by_user_id" IS NULL)
);

ALTER TABLE "workspaces"
ADD CONSTRAINT "workspaces_slug_format"
CHECK (
  "slug" IS NULL
  OR "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
);
