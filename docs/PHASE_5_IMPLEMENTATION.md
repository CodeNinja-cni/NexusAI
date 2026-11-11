# Phase 5 implementation — workspace management

## Delivered scope

Phase 5 implements the approved team-workspace lifecycle without adding authentication providers or AI behavior. Users can create, list, view, rename, switch, schedule deletion, restore, invite, accept, revoke, leave, remove members, change eligible roles, and transfer ownership through responsive App Router pages and versioned Route Handlers.

The personal workspace remains a private special case. It cannot receive invitations, non-Owner membership, ownership transfer, self-leave, or direct workspace deletion.

## Authority model

The server policy in `src/modules/workspaces/server/policy.ts` is authoritative:

| Operation | Owner | Admin | Member |
| --- | :---: | :---: | :---: |
| View workspace/member register | Yes | Yes | Yes |
| Rename workspace | Yes | Yes | No |
| Invite/remove Member | Yes | Yes | No |
| Invite/promote/demote/remove Admin | Yes | No | No |
| Leave team workspace | After transfer | Yes | Yes |
| Transfer ownership | Yes | No | No |
| Delete/restore workspace | Yes | No | No |

Platform administration never implies ordinary workspace membership. UI capabilities are hints derived from this matrix; every mutation re-resolves the database session, account readiness, active membership, workspace kind, and current role at the service boundary.

## Transaction and isolation decisions

- Team creation atomically inserts the workspace, sole Owner membership, storage quota, and audit record.
- Ownership transfer uses `SERIALIZABLE`, a transaction-scoped advisory lock keyed by workspace ID, the existing one-Owner partial unique index, and a pointer update in the same transaction.
- Invitation acceptance validates a SHA-256 digest, signed-in email, pending state, expiry, team status, and existing membership in one serializable transaction.
- Role changes, removal, deletion, and restoration take the same workspace advisory lock where cross-row invariants are involved.
- Deletion is a 30-day tombstone: `PENDING_DELETION`, `deletedAt`, and `purgeAfter`. It clears affected active-workspace preferences and makes ordinary reads return the same `404` as an inaccessible workspace.
- Restoration is the only tombstone read path and requires the retained sole Owner, an unclaimed purge, and an open recovery window.
- Active workspace selection writes `UserPreference.defaultWorkspaceId`, but every dashboard/read path rechecks current membership and falls back safely.

The Phase 5 migration adds database checks for coherent workspace deletion states, invitation closure states, and lowercase slug format. Existing partial indexes continue to enforce one Owner membership and one active invitation per normalized workspace/email pair.

## Invitations and mail

Invitation tokens use 32 random bytes. Only their SHA-256 digest is stored in `WorkspaceInvitation`. The raw credential exists in the retryable outbox payload and email link until delivery, after which the dispatcher replaces the payload with non-sensitive metadata. Links put the token in the URL fragment; the acceptance client removes it from the address bar and submits it only in an authenticated JSON body.

Owner invitations may grant `ADMIN` or `MEMBER`. Admin invitations may grant only `MEMBER`. Existing members receive the same generic accepted response without a new invitation, avoiding account enumeration and preventing an invitation from escalating an existing membership.

## Concurrency and HTTP controls

- Mutations require a trusted exact origin and validated database session.
- JSON bodies are strict Zod schemas with unknown-key rejection and a 256 KiB bound.
- Workspace/member/invitation edits use `If-Match` ETags.
- Ownership transfer and workspace deletion require a session created within ten minutes.
- Private responses are `private, no-store`; errors use stable problem details and request IDs.
- Cross-workspace and nonexistent workspace probes converge on `404` without private names or counts.

## User interface

- `/workspace` shows persisted memberships, actual member counts, active selection, deletion recovery state, switching, restoration, and team creation.
- `/workspace/[workspaceId]` exposes only operations allowed by the caller's current role.
- `/workspace/invitations/accept` consumes the fragment credential without sending it in the page request URL.
- Desktop, tablet, and narrow-mobile layouts use the existing CSS Module design system, product shell, loading state, and error boundary.

## Verification

Unit coverage locks the role matrix and strict request schemas. The disposable-PostgreSQL Playwright journey covers hostile origins, personal-workspace restrictions, cross-workspace denial, create/view/switch, responsive UI, invitation digest storage, acceptance and replay rejection, Member/Admin/Owner denials, ownership transfer, dashboard selection, deletion/restore, member removal, and two concurrent transfer attempts. The concurrency assertion proves exactly one `OWNER` row remains and that it matches `Workspace.ownerUserId`.

Run all gates with:

```bash
npm run check
npm run test:integration
```
