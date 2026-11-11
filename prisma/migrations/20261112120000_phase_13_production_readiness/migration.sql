-- Keep the canonical owner pointer and the sole OWNER membership aligned at commit time.
-- The trigger is deferred so provisioning and ownership transfer can update both rows atomically.
CREATE OR REPLACE FUNCTION "assert_workspace_owner_invariant"(affected_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  expected_owner_user_id TEXT;
  actual_owner_user_id TEXT;
  owner_count BIGINT;
BEGIN
  SELECT "owner_user_id"
  INTO expected_owner_user_id
  FROM "workspaces"
  WHERE "id" = affected_workspace_id;

  -- Cascading membership deletes run after the workspace row has disappeared.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*), min("user_id")
  INTO owner_count, actual_owner_user_id
  FROM "workspace_members"
  WHERE "workspace_id" = affected_workspace_id
    AND "role" = 'OWNER';

  IF owner_count <> 1 OR actual_owner_user_id IS DISTINCT FROM expected_owner_user_id THEN
    RAISE EXCEPTION 'workspace_owner_invariant_violation'
      USING ERRCODE = '23514',
            CONSTRAINT = 'workspace_owner_invariant';
  END IF;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_workspace_owner_invariant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    PERFORM "assert_workspace_owner_invariant"(NEW."id");
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM "assert_workspace_owner_invariant"(OLD."workspace_id");
  ELSE
    PERFORM "assert_workspace_owner_invariant"(NEW."workspace_id");
    IF TG_OP = 'UPDATE' AND OLD."workspace_id" IS DISTINCT FROM NEW."workspace_id" THEN
      PERFORM "assert_workspace_owner_invariant"(OLD."workspace_id");
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "workspaces_owner_invariant"
AFTER INSERT OR UPDATE OF "owner_user_id" ON "workspaces"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_workspace_owner_invariant"();

CREATE CONSTRAINT TRIGGER "workspace_members_owner_invariant"
AFTER INSERT OR UPDATE OR DELETE ON "workspace_members"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_workspace_owner_invariant"();
