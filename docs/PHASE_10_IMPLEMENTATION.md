# Phase 10 implementation: notifications and settings

## Delivered scope

This increment implements the notification and account-settings portion of Phase 10. Portable data export remains intentionally pending because the user request scoped this pass to notifications and settings.

## Notifications

`Notification` is a recipient-owned record with an optional workspace context, validated type, bounded text, safe application-relative action URL, read state, expiry, optimistic version, and optional event-deduplication key. The service currently accepts:

- `NEW_ACTIVITY` for membership and collaboration events;
- `DOCUMENT_PROCESSING` for ready, failed, and quarantined outcomes;
- `WORKFLOW_STATUS` as the Phase 11 producer contract; no workflow success is fabricated before the workflow engine exists;
- `SYSTEM_ALERT` for non-disableable credential and account-security events.

Document terminal state and its notification commit in the same database transaction. Invitation acceptance similarly creates recipient activity notifications inside the membership transaction. Event keys make retried producers idempotent. A recipient's optional notification preferences are checked before non-security events are written.

Notification action URLs are limited to reviewed internal product roots. Opening a link never conveys authorization: the destination page/API reauthorizes the current user and workspace resource normally.

The `/notifications` surface supports category/unread filters, mark read/unread, mark all read, removal, loading/error/empty states, and responsive layouts. APIs are current-user-only, private/no-store, origin checked for mutations, Zod validated, cursor scoped, and protected with strong ETags where individual records mutate.

## Settings

- `/settings/profile` retains optimistic, validated display-name/image updates.
- `/settings/security` adds current-password rotation through Better Auth and lists/revokes active database sessions without exposing tokens.
- `/settings/ai` persists the enabled default model, response style, source preference, code-explanation preference, and IANA time zone. Chat model ordering honors the saved enabled default.
- `/settings/notifications` persists optional activity/document/workflow notification categories. System alerts cannot be disabled.
- `/settings/account` performs workspace-ownership preflight and starts governed deletion only after a fresh session, password re-entry, and exact confirmation text.

Preference writes use the one-to-one `UserPreference` row, strong ETags, strict allowlists, current-workspace/model validation, and an audit record in the same transaction. API keys, arbitrary model IDs, unbounded JSON, and provider secrets are rejected.

## Governed account deletion

NEXUS does not enable Better Auth's immediate user deletion endpoint. A deletion request:

1. requires a session created within ten minutes and verifies the current credential password;
2. locks the user and rejects without side effects while any owned team workspace remains active;
3. schedules deletion no earlier than seven days and no earlier than any explicitly deleted owned team workspace's recovery deadline;
4. persists an `AccountDeletionRequest`, marks the user `PENDING_DELETION`, revokes every session, audits the change, and queues a cancellation email atomically;
5. accepts the email's digest-only, single-use cancellation capability only before purge begins;
6. is processed by `npm run account-deletions:process`, which removes private objects first, then due owned workspaces and the identity graph, while retained audit/usage attribution is de-identified by existing `SET NULL` relations.

The purge worker uses leases, advisory locks, bounded retry delay, safe failure codes, and idempotent storage deletion. Deployments must run it on a recurring schedule. S3 version/lifecycle policy must be configured so a delete removes all retained versions within the approved deletion window.

## Verification

Automated coverage proves:

- validated preference persistence, unsupported-model rejection, and stale-ETag failure;
- recipient-only notification listing and cross-user `404` behavior;
- individual read-state updates and durable password-change alerts;
- password rotation and revocation of another active session;
- account deletion rejection while team ownership is unresolved, without changing account status;
- session revocation after a valid deletion request and restoration through the single-use cancellation capability;
- clean application of all eight migrations.

## Deferred Phase 10 scope

Portable `MY_DATA` and Owner workspace exports, archive generation, private export artifacts, expiry, and cleanup remain pending. Workflow-status notifications will begin only when Phase 11 produces real workflow transitions.

