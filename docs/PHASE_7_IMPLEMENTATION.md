# Phase 7 implementation — conversation management

**Implemented:** 2026-11-08  
**Runtime scope:** Next.js App Router, PostgreSQL/Prisma, workspace-scoped conversation APIs and responsive chat UI

## Outcome

Phase 7 makes conversation history durable, searchable, paginated, organized, and permission-aware. A workspace member can list and read workspace conversations and their persisted message history. A conversation creator or workspace Owner/Admin can rename, archive, reactivate, or schedule deletion. Soft-deleted conversations are hidden immediately and can be restored during the 30-day recovery window.

Browser refreshes reconstruct the conversation from PostgreSQL. No history, timestamp, count, or workspace association is fabricated in the interface.

## Configuration and architecture decisions

1. **Workspace is the visibility boundary.** Every list, search, detail, and message query first reauthorizes an active `(workspaceId, userId)` membership. Conversation and message lookups retain workspace IDs in their predicates.
2. **Creator/Admin is the mutation boundary.** The conversation creator and workspace `OWNER`/`ADMIN` roles may rename, archive, reactivate, delete, and restore. Other members may read shared workspace history but receive `403` for a same-workspace mutation. A non-member receives tenant-safe `404` behavior.
3. **Archive is the organization primitive.** The approved `ACTIVE`/`ARCHIVED` lifecycle provides active, archive, and combined views without introducing an unapproved folder taxonomy. The UI additionally groups loaded history by Today, Previous 7 days, and Earlier.
4. **PostgreSQL full-text search first.** Tenant-scoped search covers conversation titles and user/assistant message content using `websearch_to_tsquery('simple', ...)`, backed by GIN expression indexes. Escaped `ILIKE` matching supports partial text while preserving parameterization.
5. **Filter-bound keyset cursors.** Conversation cursors contain the stable `(lastMessageAt, id)` boundary and their query/status/creator filters. Reusing a cursor with different filters fails validation. Message cursors bind the conversation and sequence boundary.
6. **Latest history first, chronological rendering.** The message API reads the latest page by descending sequence, then returns it in chronological order. `nextCursor` loads older rows and the client prepends them without duplicates. Limits remain bounded to 100.
7. **Optimistic lifecycle writes.** Conversation metadata has a strong ETag of `"conversation:{id}:{version}"`. `PATCH` and `DELETE` require `If-Match`; stale changes return `412` instead of overwriting another update.
8. **Recoverable deletion.** Delete sets `deletedAt` and `purgeAfter`, increments the version, and hides the resource. Delete/restore use a transaction-scoped PostgreSQL advisory lock and serializable transaction so lifecycle races resolve to one canonical state. Restore is idempotent before purge starts.
9. **No client-only persistence.** The client holds temporary render state only. Route transitions and reloads always hydrate the canonical conversation and message page from PostgreSQL.
10. **Explicit UI states.** Route-level loading/error boundaries remain in place; the library has first-use and filtered-empty states plus recoverable pagination errors. The studio distinguishes archived context and disables generation until reactivated.

## Database migration

`20261108210000_phase_7_conversation_management` adds:

- a GIN search index over normalized conversation titles;
- a partial GIN search index over user/assistant message content;
- a partial `(purge_after, id)` index for pending conversation cleanup.

The existing `Conversation` model already carried the approved status, creator, version, deletion, purge, timestamp, workspace, and message-sequence fields, so no duplicate lifecycle columns or organization model were added.

## API surface

All paths are below `/api/v1/workspaces/{workspaceId}` and require a verified, provisioned session plus current workspace membership.

| Method | Path | Authorization and behavior |
| --- | --- | --- |
| `GET` | `/conversations` | Member; keyset list with `query`, `status`, `createdByMe`, `cursor`, and `limit` filters. |
| `GET` | `/conversations/{conversationId}` | Member; metadata, timestamps, workspace association, capabilities, version, and ETag. |
| `PATCH` | `/conversations/{conversationId}` | Creator/Admin; partial validated title, status, or enabled model update with `If-Match`. |
| `DELETE` | `/conversations/{conversationId}` | Creator/Admin; soft delete with `If-Match`, returning `204`. |
| `POST` | `/conversations/{conversationId}/restoration` | Creator/Admin; idempotent restore during the recovery window. |
| `GET` | `/conversations/{conversationId}/messages` | Member; deterministic keyset page with a maximum limit of 100. |

Mutation bodies are strict Zod objects. Route IDs are UUIDs, cursors and limits are bounded, trusted-origin checks protect state changes, restore requires a UUID v4 idempotency key, and API errors use the existing RFC 9457 problem contract.

## Interface behavior

- `/chat` provides title/message search, active/archive/all filters, a created-by-me filter, date grouping, pagination, and database-backed message counts.
- Authorized per-row controls rename, archive/reactivate, and delete without nesting buttons inside links.
- Rename and delete use the accessible design-system modal with focus management and clear recovery language.
- `/chat/{conversationId}` displays the workspace, created timestamp, last-activity timestamp, per-message timestamps/status, and an older-history control.
- Archived conversations remain readable but cannot accept new generations until reactivated from history.
- The existing CSS Modules visual language remains responsive without Tailwind or a new component dependency.

## Verification coverage

The chat integration suite uses a disposable PostgreSQL instance and covers:

- forward migration application on an empty database;
- title and message-content search;
- active/archive filtering;
- creator rename/archive/delete/restore;
- Owner management of a member-created conversation;
- denial of a Member mutation against another creator's conversation;
- cross-workspace `404` isolation;
- latest/older message cursor ordering;
- soft-delete tombstone and recovery-window metadata;
- browser refresh persistence and mobile overflow;
- the existing streaming, cancellation, regeneration, usage, validation, and rate-limit paths.

## Files created

- `prisma/migrations/20261108210000_phase_7_conversation_management/migration.sql`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/[conversationId]/restoration/route.ts`
- `docs/PHASE_7_IMPLEMENTATION.md`

## Files updated

- `README.md`
- `docs/DEVELOPMENT_ROADMAP.md`
- `src/modules/chat/server/chat-service.ts`
- `src/modules/chat/server/route-support.ts`
- `src/modules/chat/server/validation.ts`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/route.ts`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/[conversationId]/route.ts`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/[conversationId]/messages/route.ts`
- `src/app/chat/page.tsx`
- `src/app/chat/[conversationId]/page.tsx`
- `src/modules/chat/components/chat-index.tsx`
- `src/modules/chat/components/chat-index.module.css`
- `src/modules/chat/components/chat-experience.tsx`
- `src/modules/chat/components/chat-experience.module.css`
- `tests/e2e/chat.spec.ts`
