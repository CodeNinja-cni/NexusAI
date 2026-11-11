# Phase 12 — Administration implementation

## Delivered surface

Phase 12 adds a separate NEXUS AI control plane at `/admin` and `/api/v1/admin/**`. It includes a command-center dashboard, user search and detail, role/status controls, session revocation, platform usage analytics, system activity, redacted audit logs, and allowlisted platform configuration. The console is responsive and uses the existing NEXUS CSS Modules design language.

Platform administration does not create workspace membership and does not alter ordinary workspace authorization. A platform administrator cannot use workspace routes to read a tenant unless they independently hold a current membership. No support impersonation or customer-content viewer was introduced.

## Authorization sequence

Every admin API request performs the following server-side checks in order:

1. Resolve the authoritative Better Auth database session.
2. Reload the active, non-deleted user record.
3. Require `PlatformRole.ADMIN`; workspace roles are ignored.
4. Require `User.twoFactorEnabled`, a verified `TwoFactor` row, and `Session.mfaVerifiedAt`.
5. For mutations, require a trusted `Origin`/same-origin fetch signal and MFA assurance no older than ten minutes.
6. Consume the PostgreSQL-backed administrator read or mutation rate limit.
7. Validate path, query, body, ETag, target state, and domain invariants inside the administration service.

Ordinary authenticated users receive `403 admin_access_denied` from admin APIs. Missing or incomplete administrator MFA receives `403 admin_mfa_required`; stale assurance receives `403 fresh_mfa_required`. UI layouts repeat authorization near the data access and render no console data for ordinary accounts. Proxy cookie checks are only an optimistic redirect and are never the authorization boundary.

Denied platform-role, MFA, trusted-origin, and freshness checks write `admin.access.denied` audit events with a stable reason code. They do not record request bodies or credentials.

## Multi-factor authentication

Better Auth's two-factor plugin provides TOTP plus encrypted, single-use recovery codes. Enrollment requires the account password and verification of the current TOTP before `twoFactorEnabled` becomes true. Sign-in with an enrolled account does not create a usable session until TOTP or a recovery code succeeds.

Trusted-device bypass is disabled. Consecutive second-factor failures are capped at five before a fifteen-minute account-level lockout. Successful TOTP/recovery verification records `Session.mfaVerifiedAt`; an already authenticated administrator can repeat TOTP verification as a step-up operation. Administrator MFA disablement is blocked at the auth Route Handler before the Better Auth handler and also guarded in auth hooks. Recovery-code rotation and MFA verification/disable events are audited.

## User administration invariants

- Only `USER` and `ADMIN` are accepted as platform roles.
- Only `ACTIVE` and `SUSPENDED` can be changed through the console. Deletion states remain owned by the governed account-deletion workflow.
- A promoted or reactivated administrator must be active, email-verified, TOTP-enabled, and have a verified factor row.
- A platform administrator cannot change their own role/status or revoke their own sessions through admin APIs.
- Removing or suspending the final active administrator is rejected under a serializable transaction after locking the active-admin set.
- Every role/status change uses `If-Match` plus the body version, increments `User.version`, and revokes all target sessions.
- Every user change and session revocation stores the bounded operator reason, allowlisted before/after values, request ID, actor, target, and outcome in `AuditLog`.

## Bootstrap and recovery

There is no public administrator grant endpoint. An active verified user first enrolls TOTP in `/settings/security`, then an operator runs:

```bash
npm run admin:bootstrap -- \
  --email operator@example.com \
  --reason "Approved initial platform operator" \
  --confirm NEXUS-FIRST-ADMIN
```

The command takes a PostgreSQL advisory transaction lock and refuses when any active administrator exists. It requires an active, non-deleted, email-verified target with a verified TOTP row, promotes the account, revokes all sessions, and writes a `SYSTEM` audit event. The operator must sign in again and complete MFA. If the active-administrator count ever becomes zero through an out-of-band incident, the same explicitly confirmed and audited command is the recovery path. There is no permanent break-glass HTTP credential.

## Data minimization

Admin responses may contain account identity/contact metadata, opaque user/workspace/target IDs, provider/model/operation identifiers, token counts, pricing provenance, safe job states, and redacted audit changes. They never contain:

- password hashes or reset/verification values;
- session tokens or auth cookies;
- prompts, messages, workflow inputs/outputs, document text, or summaries;
- storage keys, signed URLs, provider credentials, authorization headers, or raw provider errors;
- outbox payloads or secret platform settings.

Audit JSON is recursively bounded and drops keys associated with tokens, secrets, passwords, prompts, content, storage keys, and authorization data before rendering.

## Platform configuration

`PlatformSetting` stores JSON, schema version, updater, timestamps, and an optimistic version. Three keys are allowlisted:

- `user_registration`: `OPEN` or `CLOSED`; the Better Auth registration hook enforces the value.
- `maintenance_notice`: enabled flag plus a bounded safe message.
- `admin_operations`: failed-job attention threshold and default 7/30/90-day usage range.

Each key has a strict Zod schema. Unknown keys and fields are rejected. Changes require a strong `If-Match`, fresh MFA, a 12–500 character audit reason, and an atomic setting/audit transaction. Secrets remain deployment-managed and are not representable through this model.

## Endpoint inventory

- `GET /api/v1/admin/dashboard`
- `GET /api/v1/admin/users`
- `GET|PATCH /api/v1/admin/users/{userId}`
- `POST /api/v1/admin/users/{userId}/session-revocations`
- `GET /api/v1/admin/usage/summary`
- `GET /api/v1/admin/usage/records`
- `GET /api/v1/admin/activity`
- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/admin/settings`
- `PATCH /api/v1/admin/settings/{key}`

All responses use `private, no-store`. Lists use bounded filters and cursor-compatible ordering. Reads of user, usage-record, audit, and setting metadata create audit events.

## Persistence

Migration `20261111120000_phase_12_administration` adds:

- Better Auth-compatible `two_factor_enabled`, `mfa_verified_at`, and `two_factors` persistence;
- `platform_settings` with updater relation, schema/version fields, and initial safe defaults;
- `admin_rate_limit_buckets` with a compound window key and non-negative count constraint.

The Prisma schema exposes relations only where the application needs them. Recovery secrets stay encrypted by Better Auth and are never selected by the administration module.

## Verification

`tests/e2e/administration.spec.ts` uses a real disposable PostgreSQL database and real Better Auth TOTP/recovery flow. It proves:

- a workspace Owner receives API denial and no console content;
- a platform role without MFA is denied;
- verified TOTP creates recorded session assurance;
- user promotion fails before factor enrollment;
- successful promotion revokes the target's existing session and writes an audit event;
- self-status mutation is rejected;
- status changes are persisted and audited;
- stale MFA blocks mutation but not authorized reads;
- TOTP step-up restores mutation eligibility;
- stale setting ETags fail;
- an administrator cannot disable MFA;
- sign-in recovery codes establish an MFA-assured administrator session;
- audit-log and usage analytics reads remain authorized and audited.

Unit validation covers role injection, audit-reason bounds, setting schemas, unknown setting fields, and reporting-range limits. The complete quality gate also runs formatting, zero-warning lint, strict TypeScript, production build, and every prior unit/integration test.

## Intentional boundaries

Phase 12 does not add support impersonation, tenant-content inspection, audit export, bulk user mutation, secret management, billing, or a permanent emergency credential. Platform-setting history is retained in append-only audit events; a separate temporal setting-history table is unnecessary for the initial allowlist. Phase 13 should add independent security review, observability alerts for repeated denials/rate limits, dependency scanning, and production runbooks for audited recovery exercises.
