# Phase 2 implementation record

## Status

Phase 2’s explicit database, authentication, request-validation, protected-route, profile, session, and tenant-isolation requirements are implemented and covered by an empty-database integration journey.

Implementation baseline:

- Next.js `16.4.5`
- Better Auth `1.7.18`
- `@better-auth/prisma-adapter` `1.7.18`
- Prisma CLI, Client, and PostgreSQL adapter `7.10.1`
- PostgreSQL 15+ production contract; PostgreSQL 18 disposable test harness
- Zod `4.6.7`

Prisma 8 is intentionally excluded. Better Auth’s current Prisma adapter documentation says Prisma 8 is not yet supported. The lockfile is part of this compatibility decision.

## Delivered flows

| Capability | Implementation |
| --- | --- |
| Registration | Better Auth email/password client and catch-all route; 6–128 character password policy with common-password rejection; generic duplicate response. |
| Email verification | Required before sign-in; 24-hour signed link; development SMTP capture; durable provisioning state before verification. |
| Login/logout | Typed Better Auth client; database sessions; current account-state recheck on protected requests. |
| Social authentication | Optional Google and Apple OAuth; no retained bearer/ID tokens; no implicit same-email linking; verified social-user workspace provisioning. |
| Password recovery | Enumeration-safe request; 30-minute token; reset revokes all sessions transactionally. |
| Session management | Safe settings view uses session IDs/metadata only; revocation server actions resolve the Better Auth token only on the server. |
| Secure cookies | Better Auth-managed `HttpOnly`, `SameSite=Lax`, `Path=/`, and production `Secure`; no cookie Domain and no local-storage token. |
| Protected routes | Optimistic Next.js Proxy redirect plus authoritative database session checks in pages/routes/actions. |
| Profile management | Safe `GET /api/v1/me`; Zod/origin/body-limit/ETag protected `PATCH /api/v1/me`; audited update. |
| Tenant isolation | Membership lookup starts from `(workspaceId, userId)`; target workspace is returned only through that authorized relation; cross-tenant reads are `404`. |

## Database decisions

The Phase 2 migration contains Better Auth’s generated core fields plus product-owned account/workspace state. The official Better Auth CLI output was generated to a temporary file and compared before the migration was accepted. Table and column names use explicit Prisma mappings, which do not change the adapter’s logical model contract.

Better Auth’s Prisma adapter is configured with `transaction: true`. This is required so password change, reset-token consumption, and database-session revocation succeed or fail together.

Prisma Client uses `@prisma/adapter-pg` and one hot-reload-safe process singleton. Application code does not construct per-request pools.

The migration adds PostgreSQL partial indexes and checks for invariants Prisma cannot declare. The workspace service still treats the owner pointer plus sole `OWNER` membership as one transaction-level invariant.

## Session policy

- database sessions only;
- seven-day absolute expiry (`disableSessionRefresh: true`);
- 10-minute freshness window for sensitive operations;
- cookie cache disabled for immediate revocation;
- browser-session cookie for normal login (`rememberMe: false`);
- session tokens excluded from product DTOs, UI, audit metadata, and logs.

The approved 12-hour idle timeout remains a future distributed-session enhancement because Better Auth’s current database session configuration exposes sliding expiry or absolute expiry, not a separate independent idle and absolute deadline. Phase 2 chooses the unambiguous seven-day absolute cap and immediate database revocation.

## Verified-user provisioning

The verification flow is failure-safe:

1. `beforeEmailVerification` upserts `UserProvisioning(PENDING)` and a deduplicated provisioning outbox event.
2. Better Auth marks the email verified.
3. `afterEmailVerification` attempts the product transaction.
4. A PostgreSQL advisory transaction lock serializes retries for that user.
5. The transaction creates/reuses one personal workspace, sole Owner membership, quota, preference/default workspace, audit event, and `READY` state.
6. Failure records only `provisioning_failed`, sets a retry time, and leaves product access closed.
7. The dispatcher retries due events idempotently.

No external SMTP call occurs inside the provisioning transaction.

## Email delivery

Verification and recovery messages are stored as deduplicated outbox events. While retryable, the payload is restricted to recipient, display name, template, and the single-purpose Better Auth URL. Successful delivery replaces the URL and recipient with non-sensitive delivery metadata. Delivery failures store a redacted code and bounded exponential retry time. The dispatcher never logs URLs or tokens.

Mailpit provides the local SMTP capture interface. Production must provide a transactional SMTP service and schedule the dispatcher. Provider retention, residency, and bounce/complaint integration remain deployment decisions.

## Request and authorization boundary

Better Auth owns validation and origin/Fetch Metadata checks below `/api/auth`. NEXUS-owned mutations additionally require trusted origin evidence, JSON content type, a 256 KiB body limit, Zod parsing, and authenticated current account state.

Profile changes use strong ETags. A missing `If-Match` is `428`; a stale version is `412`. Cross-tenant workspaces return the same `404` as missing/deleted workspaces.

Proxy is not an authorization boundary. It checks cookie presence only for fast redirects, while every protected data access validates the database session and membership again.

## Test evidence

`npm run test:integration` starts a disposable real PostgreSQL cluster, applies the committed migration to an empty database, starts Next.js, and runs one serial black-box journey covering:

- unauthenticated product denial and protected-page redirect;
- hostile-origin registration rejection;
- registration and enumeration-safe no-session response;
- verification email event and link consumption;
- verified-user personal-workspace/Owner provisioning;
- login and cookie attributes;
- protected profile and workspace access;
- two-user cross-workspace denial in both directions;
- product mutation origin enforcement;
- profile validation and optimistic concurrency;
- recovery email, password reset, and existing-session revocation;
- old-password rejection and new-password login;
- logout and protected-resource denial afterward.

Vitest separately covers environment fail-closed behavior, auth/profile input validation, and reusable rendering primitives.

## Implementation file inventory

Phase 2 added these database and operational files:

- `compose.yaml`
- `docker/postgres/init/01-create-test-database.sql`
- `prisma7.config.ts`
- `prisma/schema.prisma`
- `prisma/migrations/migration_lock.toml`
- `prisma/migrations/20261107172318_phase_2_database_auth/migration.sql`
- `scripts/dispatch-outbox.ts`
- `scripts/with-test-postgres.ts`

It added the auth/product routes and pages under `src/app`:

- `api/auth/[...all]/route.ts`
- `api/v1/me/route.ts`
- `api/v1/workspaces/[workspaceId]/route.ts`
- `auth/{register,login,verify-email,verified,forgot-password,reset-password,provisioning}/page.tsx`
- `dashboard/{page.tsx,page.module.css,loading.tsx}`
- `settings/profile/{page.tsx,page.module.css,loading.tsx}`

It added these application modules and adapters:

- `src/components/ui/{form-field.tsx,form-field.module.css}`
- `src/modules/auth/client.ts`
- `src/modules/auth/components/{auth-card,email-action-form,login-form,logout-button,profile-form,register-form,reset-password-form}*`
- `src/modules/auth/server/{auth.ts,session.ts,session-actions.ts}`
- `src/modules/workspaces/server/{authorization.ts,provision-personal-workspace.ts}`
- `src/platform/database/prisma.ts`
- `src/platform/http/{problem.ts,request.ts}`
- `src/platform/mail/auth-email.ts`
- `src/proxy.ts`
- `src/shared/validation/auth.ts`

It added `tests/e2e/auth.spec.ts`, `tests/unit/auth-validation.test.ts`, and this implementation record. Phase 1 configuration, environment, health, home/header, error-boundary, module README, dependency, lockfile, and test-runner files were extended in place. `src/generated/prisma/**` is generated by `postinstall` and deliberately ignored rather than maintained as source.

## Operations and recovery

- Readiness now depends on PostgreSQL; liveness does not.
- Apply committed migrations with `npm run db:deploy`.
- Run `npm run outbox:dispatch` from a bounded scheduler.
- Treat failed provisioning or email rows as operational work; do not expose payloads in dashboards/logs.
- Use managed backups before production migration.
- Recover through compatible application rollback or a corrective forward migration. Never reset a retained database.

## Explicitly deferred

- AI/model integration and all generated-content behavior;
- Redis job transport and horizontally leased outbox workers;
- public team-workspace and invitation APIs;
- governed account deletion and storage purge orchestration;
- email-change and authenticated provider-linking settings;
- independent 12-hour idle timeout alongside the seven-day absolute cap;
- row-level security until safe Prisma pool/session tenant context is proven.
