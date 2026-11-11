# NEXUS AI

NEXUS AI is a server-first, multi-workspace application built with Next.js App Router. The implemented foundation now spans identity, design, landing/dashboard, complete workspace management, durable AI chat, conversation management, private document intelligence, auditable usage management, notifications, persistent account settings, controlled AI workflows, and MFA-backed platform administration.

Vector retrieval, billing, and knowledge curation are intentionally not implemented yet.

The Phase 13 review concluded that the application is **not yet production-ready**. See
[`docs/PHASE_13_PRODUCTION_READINESS.md`](docs/PHASE_13_PRODUCTION_READINESS.md) for the verified fixes, test evidence, and blocking risks.
Phase 14 deployment tooling and the complete operator runbook are documented in
[`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md); no remote production deployment is claimed.

## Current implementation

- Next.js 16 App Router and React 19, with Server Components by default
- Strict TypeScript, ESLint, Prettier, CSS Modules, and global design tokens
- Prisma 7 with the PostgreSQL driver adapter and a committed forward migration
- Better Auth 1.7.18 with its official Prisma adapter and database transactions
- Optional Google and Apple OAuth with no retained bearer/ID tokens, explicit account linking, and server-only credentials
- Registration with enumeration-safe duplicate handling
- Required email verification before sign-in
- Login and logout with database-backed sessions
- Password recovery with 30-minute single-use links and full session revocation
- Secure production cookies (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`)
- Seven-day absolute session lifetime, 10-minute freshness window, and no cookie session cache
- Safe session listing and server-side revocation without exposing session tokens
- Validated profile reads and optimistic-concurrency updates
- Idempotent personal-workspace provisioning after email verification
- Near-data workspace authorization and cross-tenant `404` behavior
- Durable database outbox for verification/recovery email and provisioning retries
- PostgreSQL readiness checks, unit tests, and a full authentication integration journey
- NEXUS design tokens for color, typography, spacing, focus, motion, elevation, and responsive layout
- Reusable actions, form controls, overlays, cards, navigation, sidebar, data, loading, toast, empty, and error patterns
- Public `/design-system` reference surface with keyboard, mobile, and automated WCAG A/AA coverage
- Complete responsive landing page with truthful availability states, original CSS interface studies, product metadata, and a bespoke social card
- Protected responsive workspace dashboard with database-backed usage, storage, recent conversations/documents, membership overview, and audit activity
- Additive conversation, document, and immutable usage-record roots for truthful dashboard reads
- PostgreSQL-backed dashboard isolation coverage proving that one user never sees another workspace's recent resources
- Complete team-workspace create, view, rename, switch, delete, and 30-day restore lifecycle
- Owner/Admin/Member policy derived on the server, with personal workspaces permanently sole-owner
- Email invitations with digest-only token storage, seven-day expiry, safe resend/revoke, and transactional outbox delivery
- Member role changes, non-Owner self-leave, Admin-to-Member management, and Owner-only Admin management
- Serializable ownership transfer with an advisory workspace lock, a sole-Owner partial index, and owner-pointer consistency tests
- Responsive `/workspace` and `/workspace/[workspaceId]` management surfaces backed only by live database records
- Abstract `AiProvider` contract with an OpenAI implementation powered by Vercel AI SDK `streamText`
- Explicit local/test mock provider with deterministic streaming and unmistakable mock labelling; it is never a fallback for OpenAI
- NEXUS-owned SSE protocol with started, delta, completed, cancelled, error, and heartbeat events
- Persisted user/assistant messages, atomic per-conversation sequence allocation, parent branches, and non-destructive regeneration
- Provider abort propagation, durable cancellation state, database polling for cross-instance cancellation, timeout handling, and safe provider errors
- Provider-reported OpenAI token usage and explicitly marked mock estimates persisted in immutable usage records
- PostgreSQL-backed atomic per-user and per-workspace generation rate limits, with no in-memory correctness dependency
- Responsive `/chat` history and `/chat/[conversationId]` studio with model selection, safe GFM Markdown, syntax highlighting, stop, recovery, and regenerate controls
- Strict request bodies, server-only API keys, allowlisted model aliases, tenant-scoped reads, and cross-workspace denial tests
- Workspace-scoped title and message-content search backed by PostgreSQL full-text GIN indexes
- Keyset-paged conversation and message history with deterministic ordering and filter-bound cursors
- Creator/Admin rename, archive/reactivate, recoverable delete, and restore enforced server-side with strong ETags
- Database-backed message counts, workspace association, conversation/message timestamps, and refresh persistence
- Responsive active/archive/all history views with date grouping, loading, empty, archived, and recoverable error states
- Direct private PDF, DOCX, and TXT uploads with client progress, signed five-minute PUT grants, exact size/type checks, SHA-256 integrity verification, and a 25 MiB default limit
- S3-compatible production storage, private Garage local development, and a filesystem-only test adapter with short-lived signed download grants
- ClamAV streaming scans in deployed environments, strict magic-byte/container/UTF-8 validation, DOCX archive-bomb bounds, PDF page bounds, and safe quarantine/failure states
- Transactional document-processing outbox, idempotent BullMQ/Redis jobs, separately scalable worker process, bounded retries, and atomic terminal writes
- PDF.js, Mammoth, and strict UTF-8 extractors; versioned character chunks; extractive summaries; and PostgreSQL `simple` full-text GIN indexing
- Retrieval behind a `DocumentRetriever` port so PostgreSQL FTS can be replaced by pgvector without coupling chat or HTTP contracts to an embedding provider
- Grounded streaming document questions with persisted conversations, retrieved source snapshots, bounded citation excerpts, and normal provider/rate-limit/token accounting
- Responsive `/documents` library and `/documents/[documentId]` record with real upload progress, processing polling, summaries, metadata, downloads, and cited Q&A
- PostgreSQL-backed malformed-file, worker, FTS, private-download, grounded-answer, mobile-layout, and cross-workspace authorization coverage
- Immutable AI usage ledger with explicit provider-reported, development-estimate, and unavailable provenance
- Effective-dated model-price catalog with immutable rate snapshots; no application price is seeded or guessed
- Estimated-cost calculation from persisted provider token totals, including cached-input pricing when configured
- Atomic UTC-month workspace quota reservations and reconciliation for requests, input/output tokens, and estimated cost
- Owner/Admin quota configuration with ETags, strict decimal-string validation, server-side enforcement, and audit events
- Responsive `/usage` intelligence surface with daily consumption, pricing coverage, quota state, and privacy-scoped records
- Validated summary, cursor-record, and quota APIs with Member self-record scope and Admin/Owner workspace-record scope
- Recipient-private notification history for workspace activity, document outcomes, workflow execution status, and mandatory system alerts
- Durable notification producers, idempotent event keys, safe internal action URLs, cursor filtering, read/unread state, and strong ETags
- Persistent profile, security, password, active-session, AI, time-zone, and notification preference settings
- Governed account deletion with fresh authentication, password proof, ownership preflight, immediate session revocation, grace period, cancellation capability, and leased purge processing
- Versioned workflow shells and immutable graph definitions with content digests, draft/active/archive lifecycle, 30-day recoverable deletion, and safe restoration
- Responsive `/workflows` library and visual `/workflows/[workflowId]` node canvas with keyboard-accessible positioning, node configuration, typed connections, publishing, execution, history, and redacted logs
- Four allow-listed initial nodes: input, literal text template, AI prompt, and output; strict schemas make code, shell, SQL, filesystem, dynamic package, expression-evaluation, and arbitrary network nodes unrepresentable
- Controlled BullMQ/Redis workflow worker with durable outbox publication, version/input binding, membership reauthorization, start/concurrency/step/time/input/output ceilings, cooperative cancellation, and idempotent terminal transitions
- Real workflow AI usage reservations and immutable provider usage records linked to executions, with no fabricated pricing or token totals
- Owner/Admin authoring and publication, Member execution, cross-tenant `404` behavior, structured audit records, workflow-status notifications, and adversarial graph/isolation coverage
- Separate `PlatformRole.ADMIN` authorization that is never inferred from workspace ownership or membership
- Better Auth TOTP enrollment, encrypted recovery codes, five-attempt lockout, no trusted-device bypass, and database-recorded MFA assurance per session
- Responsive `/admin` command center for user posture, account status, aggregate usage, system activity, audit records, and allowlisted platform configuration
- Administrator promotion prerequisites, last-active-admin protection, self-administration denial, automatic session revocation, fresh-MFA mutations, strict origin validation, and PostgreSQL-backed admin rate limits
- Safe user/usage/audit read models that exclude passwords, session tokens, prompts, document content, storage keys, credentials, signed URLs, and raw provider payloads
- Atomic optimistic platform-setting changes with key-specific schemas, strong ETags, bounded audit reasons, and no secret-writing surface
- Confirmed first-admin/recovery bootstrap that only works when no active administrator exists and the target has verified email plus verified TOTP
- Non-root standalone web, worker, and one-shot migration container targets built from one immutable revision
- Strict production configuration validation, pooled/direct PostgreSQL separation, workload-identity storage support, and client-bundle secret scanning
- Structured redacted JSON logging, sanitized server error delivery, and bearer-protected database/Redis/storage/scanner dependency monitoring
- Provider-neutral deployment, backup, restore, rollback, incident, and remote smoke-test procedures

## Supported toolchain

- Node.js 26 LTS is recommended; `.nvmrc` pins `26.13.0`.
- Node.js `>=22.13.0` is enforced in `package.json`.
- npm 9 or newer.
- PostgreSQL 15 or newer for normal development/deployment.
- Docker with the Compose plugin is the easiest local service path.

Versions are exact-pinned. In particular, Better Auth 1.7.18 is paired with Prisma 7.10.1 because the current Better Auth Prisma adapter does not support Prisma 8. Upgrade this set together, generate and review the Better Auth schema, create a migration, and run every quality gate.

## Quick start

Start PostgreSQL, Redis, private Garage storage, and Mailpit, waiting for health checks:

```bash
docker compose up -d --wait postgres redis garage mailpit
```

Install and configure the app:

```bash
nvm use
npm ci
cp .env.example .env.local
openssl rand -base64 32
```

Put the generated value in `BETTER_AUTH_SECRET` inside `.env.local`, then apply the migration and start Next.js:

```bash
npm run storage:init
npm run db:deploy
npm run dev
```

In three additional terminals, run the durable outbox dispatcher plus the document and workflow workers:

```bash
npm run outbox:dispatch
npm run worker:documents
npm run worker:workflows
```

The outbox command is a bounded pass; run it on a recurring schedule in deployment. The worker is long-lived. Local `DOCUMENT_SCANNER=structural` performs format validation only; production configuration is rejected unless `DOCUMENT_SCANNER=clamav`.

Open:

- application: [http://localhost:3000](http://localhost:3000)
- Mailpit development inbox: [http://localhost:8025](http://localhost:8025)

Mailpit accepts SMTP on port `1025`. Verification and recovery emails are never written to application logs.

### Optional Google and Apple sign-in

Email/password authentication works without provider credentials. To enable Google, create a Web OAuth client and put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`. Register this exact local callback:

```text
http://localhost:3000/api/auth/callback/google
```

Apple requires an Apple Developer Services ID, Team ID, Key ID, and the downloaded `.p8` private key. Apple does not accept localhost or non-HTTPS return URLs, so use a real HTTPS development or production domain and register:

```text
https://your-domain.example/api/auth/callback/apple
```

Set `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` together. The server generates the short-lived Apple client-secret JWT; no Apple key or Google secret is sent to the browser. Restart the development server after changing provider variables.

`npm run storage:init` is idempotent. It applies and reads back `docker/minio/cors.json`, performs a signed put/get/delete round trip, and proves the `nexus-private` bucket does not accept an anonymous bucket request. Inspect the local Garage node with:

```bash
docker compose exec garage /garage status
```

Garage v2.5.0 creates the local access key and `nexus-private` bucket during its single-node bootstrap. It keeps its state in `nexus-garage-data`. The former `nexus-minio-data` declaration remains in `compose.yaml` so this change does not remove the previous volume or its objects. Garage cannot read MinIO's internal volume format; migrate valuable legacy objects through the S3 API before manually retiring that volume. Do not use `docker compose down --volumes` when data must be preserved.

This Garage topology is intentionally local-only: it has one node and one replica. Production still requires approved private managed S3-compatible storage with encryption, lifecycle, audit, and recovery controls.

The copied environment uses `AI_PROVIDER=mock`, so chat works locally without paid credentials and every response identifies itself as a mock. To use OpenAI, set `AI_PROVIDER=openai`, provide `OPENAI_API_KEY`, and choose the deployed model in `AI_OPENAI_MODEL`. A missing or failing OpenAI configuration returns an honest provider error; the application never substitutes mock output.

## Commands

| Command                               | Purpose                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                         | Start the Next.js development server.                                                                                       |
| `npm run build`                       | Produce an optimized production build.                                                                                      |
| `npm run start`                       | Serve an existing production build.                                                                                         |
| `npm run lint`                        | Run ESLint with zero warnings allowed.                                                                                      |
| `npm run typecheck`                   | Run strict TypeScript checking.                                                                                             |
| `npm test`                            | Run the Vitest unit suite.                                                                                                  |
| `npm run test:e2e`                    | Run Playwright against the configured PostgreSQL instance.                                                                  |
| `npm run test:design-system`          | Run focused WCAG, keyboard, and responsive design-system browser checks.                                                    |
| `npm run test:integration`            | Start disposable user-space PostgreSQL, migrate it, run the complete browser suite, then remove it. Docker is not required. |
| `npm run db:generate`                 | Regenerate Prisma Client from `prisma/schema.prisma`.                                                                       |
| `npm run db:migrate -- --name <name>` | Create and apply a development migration.                                                                                   |
| `npm run db:deploy`                   | Apply committed migrations without development drift checks.                                                                |
| `npm run db:status`                   | Inspect production migration status using `DIRECT_URL` when supplied.                                                       |
| `npm run db:studio`                   | Open Prisma Studio against `DATABASE_URL`.                                                                                  |
| `npm run storage:init`                | Apply local bucket CORS and verify private, signed Garage S3 operations.                                                    |
| `npm run outbox:dispatch`             | Deliver due auth-email events and retry due personal-workspace provisioning.                                                |
| `npm run worker:documents`            | Run the long-lived Redis/BullMQ document extraction and indexing worker.                                                    |
| `npm run worker:workflows`            | Run the long-lived Redis/BullMQ controlled workflow worker.                                                                 |
| `npm run pricing:import -- ...`       | Import one operator-supplied immutable model price with effective dates and an HTTPS source.                                |
| `npm run account-deletions:process`   | Process due governed account deletions as a bounded recurring deployment task.                                              |
| `npm run admin:bootstrap -- ...`      | Promote the first/recovery administrator out of band after verified TOTP enrollment; refuses while an active admin exists.  |
| `npm run deploy:validate`             | Fail closed on an incomplete or unsafe staging/production environment without printing secret values.                       |
| `npm run deploy:scan-client`          | Scan the built public client assets for configured and recognizable secret values.                                          |
| `npm run deploy:smoke`                | Verify a deployed origin, health contracts, security headers, and optional protected dependencies.                          |
| `npm run security:scan-secrets`       | Scan repository text for recognizable private-key and provider-token formats.                                               |
| `npm run format`                      | Format source and configuration files.                                                                                      |
| `npm run format:check`                | Verify formatting without changes.                                                                                          |
| `npm run check`                       | Run formatting, lint, types, unit tests, and a production build.                                                            |

`postinstall` generates Prisma Client so a clean `npm ci` is build-ready. Generated client code is ignored by Git.

## Environment configuration

Copy `.env.example` to `.env.local`. Never commit a populated `.env*` file.

| Variable                                                                   | Required                                          | Purpose                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                  | No locally                                        | `local`, `test`, `preview`, `staging`, or `production`. Controls deployment validation and secure cookies.  |
| `APP_BASE_URL`                                                             | Yes outside local/test unless `VERCEL_URL` exists | Canonical origin only. Deployed values must use HTTPS. Better Auth callbacks are bound to this origin.      |
| `SERVICE_NAME` / `RELEASE_VERSION`                                         | Release identity                                  | Safe structured-log and error-report identity; release is required when deployed.                           |
| `MONITORING_TOKEN`                                                         | Yes outside local/test                            | Server-only bearer token for the protected dependency monitor.                                              |
| `ERROR_REPORTING_ENDPOINT` / `ERROR_REPORTING_TOKEN`                       | Required in production                            | HTTPS sanitized server-error collector and server-only bearer credential.                                   |
| `DATABASE_URL`                                                             | Yes outside local/test                            | PostgreSQL connection URL used by Prisma and Better Auth.                                                   |
| `DIRECT_URL`                                                               | Provider-specific                                 | Direct TLS PostgreSQL URL used by migration commands instead of a transaction pool.                         |
| `TEST_DATABASE_URL`                                                        | Recommended                                       | Dedicated test database URL for developer tooling; never point tests at shared development/production data. |
| `BETTER_AUTH_SECRET`                                                       | Yes outside local/test                            | At least 32 random characters. Generate with `openssl rand -base64 32`.                                     |
| `AUTH_TRUSTED_ORIGINS`                                                     | Optional                                          | Comma-separated additional HTTP(S) origins. `APP_BASE_URL` is always trusted.                               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                                | Optional pair                                     | Enables Google OAuth. The secret stays server-only; register the exact Better Auth callback URL.            |
| `APPLE_CLIENT_ID` / `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY` | Optional group                                    | Enables Apple OAuth and server-generated client-secret JWTs. Apple web callbacks require a real HTTPS host. |
| `SMTP_HOST`                                                                | Yes outside local/test                            | SMTP service host. Defaults to local Mailpit.                                                               |
| `SMTP_PORT`                                                                | No                                                | SMTP port, default `1025`.                                                                                  |
| `SMTP_SECURE`                                                              | No                                                | `true` for implicit TLS, otherwise `false`.                                                                 |
| `SMTP_USER` / `SMTP_PASSWORD`                                              | Provider-specific                                 | SMTP credentials. They remain server-only.                                                                  |
| `SMTP_FROM`                                                                | Yes outside local/test                            | Verified sender identity.                                                                                   |
| `LOG_LEVEL`                                                                | No                                                | `debug`, `info`, `warn`, or `error`.                                                                        |
| `VERCEL_URL`                                                               | Platform-supplied                                 | Secure preview-origin fallback when `APP_BASE_URL` is absent.                                               |
| `AI_PROVIDER`                                                              | No locally; validated everywhere                  | `mock` in local/test only, or `openai`. Deployed environments default to and require OpenAI configuration.  |
| `OPENAI_API_KEY`                                                           | When `AI_PROVIDER=openai`                         | Server-only OpenAI credential. Never serialized or exposed through `NEXT_PUBLIC_*`.                         |
| `AI_OPENAI_MODEL`                                                          | No                                                | Provider model behind the stable `openai/nexus-core` application alias; default `gpt-5-mini`.               |
| `AI_REQUEST_TIMEOUT_MS`                                                    | No                                                | Total provider deadline, bounded from 5,000 to 300,000 ms.                                                  |
| `AI_MAX_INPUT_CHARACTERS`                                                  | No                                                | Total server-enforced prompt/context ceiling, default 128,000 characters.                                   |
| `AI_MAX_OUTPUT_TOKENS`                                                     | No                                                | Server-enforced output ceiling, default 2,048.                                                              |
| `AI_REQUESTS_PER_MINUTE`                                                   | No                                                | Atomic limit applied independently to the user and workspace, default 12.                                   |
| `AI_MOCK_CHUNK_DELAY_MS`                                                   | Local/test only                                   | Deterministic mock pacing for stream/cancellation testing.                                                  |
| `OBJECT_STORAGE_DRIVER`                                                    | No locally                                        | `s3` normally; `filesystem` is rejected outside tests.                                                      |
| `S3_ENDPOINT`                                                              | Provider-specific                                 | HTTPS S3-compatible endpoint; omit for the AWS SDK provider default.                                        |
| `S3_REGION` / `S3_BUCKET`                                                  | Yes when deployed                                 | Storage region and private lowercase bucket.                                                                |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`                                | Provider-specific                                 | Configure together or omit both for workload identity.                                                      |
| `S3_FORCE_PATH_STYLE`                                                      | Provider-specific                                 | Defaults to `true` for local Garage and generic S3-compatible endpoints.                                    |
| `QUEUE_DRIVER`                                                             | No locally                                        | `bullmq` normally; the `direct` non-blocking test adapter is rejected outside tests.                        |
| `REDIS_URL`                                                                | Yes when deployed                                 | Redis connection used by the document and workflow job queues.                                              |
| `QUEUE_NAMESPACE`                                                          | No                                                | Lowercase queue prefix, default `nexus`.                                                                    |
| `DOCUMENT_WORKER_CONCURRENCY`                                              | No                                                | Per-worker parallelism, bounded from 1 to 32; default 2.                                                    |
| `DOCUMENT_MAX_BYTES`                                                       | No                                                | Upload ceiling, default 26,214,400 bytes (25 MiB).                                                          |
| `DOCUMENT_MAX_PAGES`                                                       | No                                                | PDF extraction ceiling, default 500 pages.                                                                  |
| `DOCUMENT_CHUNK_CHARACTERS` / `DOCUMENT_CHUNK_OVERLAP_CHARACTERS`          | No                                                | Versioned character chunk size/overlap, default 1,600/200.                                                  |
| `DOCUMENT_SCANNER`                                                         | Yes when deployed                                 | `structural` in local/test only; deployed environments require `clamav`.                                    |
| `CLAMAV_HOST` / `CLAMAV_PORT`                                              | Host required when deployed                       | Private ClamAV INSTREAM service, default port 3310.                                                         |
| `WORKFLOW_MAX_NODES` / `WORKFLOW_MAX_STEPS`                                | No                                                | Publication/execution graph ceilings, default 40 nodes and 100 steps.                                       |
| `WORKFLOW_TIMEOUT_MS`                                                      | No                                                | Total controlled-run wall deadline, default and maximum 600,000 ms.                                         |
| `WORKFLOW_MAX_INPUT_CHARACTERS` / `WORKFLOW_MAX_OUTPUT_CHARACTERS`         | No                                                | Per-run input and per-node/output character ceilings, default 16,000/32,000.                                |
| `WORKFLOW_CONCURRENT_PER_WORKSPACE`                                        | No                                                | Queued/running execution ceiling per workspace, default 2.                                                  |

`src/platform/env/schema.ts` validates all server configuration without echoing secret values. No authentication, database, SMTP, AI, object-storage, Redis, or scanner value is exposed through `NEXT_PUBLIC_*`.

## Database and migrations

The implemented Phase 2 through Phase 11 subset lives in `prisma/schema.prisma` and includes:

- Better Auth `User`, `Session`, `Account`, `Verification`, and `RateLimit` models;
- user preferences and durable provisioning state;
- recipient notifications and governed account-deletion requests;
- workspaces, memberships, invitations, and storage quota state;
- append-oriented audit records and durable outbox events.
- workspace-scoped conversation and document roots for recent-resource queries;
- immutable provenance-aware usage-attempt records, effective-dated price snapshots, workspace usage policies, monthly quota periods, and idempotent reservations;
- branch-aware messages with durable generation states, client idempotency identifiers, parent/supersedes links, and atomic sequence allocation;
- PostgreSQL generation-rate buckets shared across application instances.
- recoverable conversation lifecycle, stable timestamp/version fields, and workspace/creator ownership metadata.
- processing-run snapshots, immutable document chunks, conversation-document attachments, and citation snapshots with tenant-safe composite foreign keys.
- workflow metadata, immutable definition versions, version-bound executions, increasing-sequence redacted logs, and execution-linked usage records.

The migrations add constraints Prisma cannot express directly:

- one active personal workspace per owner;
- one `OWNER` membership per workspace;
- workflow active-version scope, live case-insensitive name uniqueness, tenant-safe execution/version binding, and bounded JSON/limit checks;
- one pending invitation per workspace/lowercased email;
- no Owner invitations;
- complete `READY` provisioning state;
- non-negative quota, attempt, and retry counters.
- non-negative document/usage accounting and complete document deletion-state metadata;
- partial uniqueness for provider request reconciliation.
- coherent workspace deletion and invitation closure states;
- lowercase workspace-slug validation at both the application and database boundary.
- tenant-safe composite conversation/message references, partial client-ID uniqueness, coherent message/cancellation state, and a same-conversation active-leaf reference.
- tenant-scoped title/message full-text indexes and a pending-conversation-purge index.
- generated chunk `tsvector`, GIN document/chunk search indexes, unique processing attempts, active-run integrity, and pending-document-purge indexing.
- non-negative price, quota, reservation, and settlement snapshots with complete priced-record rate evidence.

### Development migration workflow

1. Change `prisma/schema.prisma`.
2. Run `npm run db:migrate -- --name descriptive_name` against the local development database.
3. Review the generated SQL, especially referential actions, partial indexes, enum changes, and destructive warnings.
4. Run `npm run db:generate`.
5. Apply the complete migration history to an empty database with `npm run test:integration`.
6. Commit the schema and migration together.

### Production recovery policy

Migrations are forward-only in production. Before deployment, use a managed database backup/snapshot and verify restore access. If application code must be rolled back after a compatible additive migration, roll back the application and leave the migration in place. If a migration is faulty, write and review a corrective forward migration; do not edit an already-applied migration or run `migrate reset` on retained data.

`prisma migrate reset` is destructive and is permitted only for disposable local/test databases.

## Authentication lifecycle

Better Auth owns HTTP behavior under `GET|POST /api/auth/[...all]`. Product code uses its typed client/server API rather than duplicating password or session endpoints.

### Registration and verification

1. `/auth/register` validates name, email, and a 6–128 character password while rejecting known common values.
2. Better Auth hashes the password with its default `scrypt` implementation.
3. Registration does not create a session and returns a generic duplicate-address response.
4. A 24-hour verification link is queued through the database outbox.
5. Before marking the email verified, the verification hook durably records provisioning work.
6. The post-verification transaction creates the personal workspace, Owner membership, quota, default preference, audit row, and `READY` state.
7. Sign-in is denied until verification succeeds.

Google and Apple use Better Auth's state/PKCE redirect flow. Provider credentials remain server-only, provider bearer/ID tokens are discarded before persistence, and implicit linking to an existing same-email account is disabled. New verified social accounts enter the same idempotent personal-workspace provisioning path before dashboard access.

If immediate provisioning fails, the durable event remains retryable and product routes fail closed with `503 account_provisioning`. Run `npm run outbox:dispatch` from a scheduler until a separately deployed worker is introduced.

### Login, logout, and sessions

- Sessions live in PostgreSQL; only Better Auth’s session cookie reaches the browser.
- Cookie session caching is disabled, so revocation is effective on the next request.
- Session tokens are not rendered by the settings page, returned by product APIs, written to audit metadata, or logged.
- Proxy performs only an optimistic cookie-presence redirect. Pages, route handlers, server actions, and the data-access layer validate the database session again.
- Suspended, pending-deletion, deleted, or missing users cannot create or use product sessions.

### Password recovery

- Requests use enumeration-safe responses.
- Reset links expire after 30 minutes.
- Password validation occurs before consuming the token.
- A successful reset changes the password and revokes all sessions in one adapter transaction.
- Reset never signs the user in automatically.

## Authorization and request validation

`src/modules/auth/server/session.ts` resolves the Better Auth session and current account state from PostgreSQL. `src/modules/workspaces/server/authorization.ts` then authorizes a workspace by the compound `(workspaceId, session.user.id)` membership key before returning tenant data.

Workspace resources never accept a user ID or role from request JSON. Inaccessible, deleted, and cross-tenant workspaces all return the same `404` response to prevent enumeration. Platform administration remains separate and does not imply workspace membership.

The fixed collaboration matrix is:

| Capability                 |         Owner         | Admin | Member |
| -------------------------- | :-------------------: | :---: | :----: |
| View workspace and members |          Yes          |  Yes  |  Yes   |
| Rename workspace           |          Yes          |  Yes  |   No   |
| Invite/remove Members      |          Yes          |  Yes  |   No   |
| Invite or manage Admins    |          Yes          |  No   |   No   |
| Transfer ownership         |          Yes          |  No   |   No   |
| Delete/restore workspace   |          Yes          |  No   |   No   |
| Leave workspace            | Transfer/delete first |  Yes  |  Yes   |

Personal workspaces do not expose collaboration, leave, transfer, or direct deletion routes. Team ownership transfer and deletion require a database-validated session created within the preceding ten minutes.

NEXUS-owned mutations:

- require `application/json` with a 256 KiB limit;
- validate bodies with Zod before service/database work;
- verify `Origin` against the configured trusted origins;
- use safe RFC 9457-style problem responses;
- require ETags for profile concurrency;
- return `Cache-Control: private, no-store`.

Better Auth independently validates its request schemas, callback URLs, origin, Fetch Metadata, cookies, and auth-specific rate limits.

## Chat engine

The browser never calls OpenAI directly. It sends a validated, same-origin request to a workspace-scoped route, where the service reauthorizes membership, consumes atomic user/workspace rate-limit buckets, persists a completed user row and pending assistant row, loads the authoritative message branch, and only then opens the provider stream. The OpenAI adapter uses Vercel AI SDK `streamText` with an abort signal, total/chunk deadlines, bounded retries, an output-token ceiling, and OpenAI response storage disabled.

NEXUS exposes its own stable SSE events rather than leaking provider-specific chunks. Text is checkpointed in bounded batches. The terminal transaction persists canonical content, finish reason, provider/model snapshot, status, active branch leaf, and usage. Failed, timed-out, and cancelled attempts retain safe states and any partial text; raw provider errors are never returned.

Cancellation writes `CANCEL_REQUESTED` before signalling the active process. A local registry shortens same-process cancellation latency, while database polling provides cross-instance correctness. Generation rate limits are also PostgreSQL-backed and atomic. Managed Redis remains an architecture option before high-volume public deployment, but neither cancellation nor the implemented limiter relies solely on process memory.

Provider behavior is explicit:

- `AI_PROVIDER=openai` enables only the `openai/nexus-core` alias and never falls back.
- `AI_PROVIDER=mock` is rejected in preview, staging, and production.
- The mock provider has a distinct model key, visible UI warning, deterministic content, abort support, and usage metadata marked as an estimate.
- OpenAI tokens come from provider usage metadata. Cost is calculated only when an approved model-price row was effective when capacity was reserved; otherwise the record is explicitly `UNPRICED` and the dashboard never presents zero as known spend.

Stream resumption is intentionally not implemented because the AI SDK documents resumable streams and abort as incompatible. A disconnected browser reconciles through the persisted message endpoint and may regenerate a failed/cancelled attempt.

## Document intelligence

Production uploads go directly from the browser to a private S3-compatible bucket with a short-lived signed PUT. NEXUS reserves workspace quota before issuing the grant, and upload completion independently verifies private object metadata before settling quota and queuing parser work. Client-reported completion is never trusted as proof that a file is valid.

`npm run worker:documents` consumes idempotent BullMQ jobs from Redis. It rechecks SHA-256, streams content through ClamAV in deployed environments, verifies the actual PDF/DOCX/TXT format, extracts normalized text, creates versioned overlapping chunks, and atomically publishes the active run, summary, page count, and `READY` state. Failed parsing creates no active chunks; malware or binary/type mismatch is quarantined. `npm run outbox:dispatch` retries queue publishing after outages.

PostgreSQL full-text search is the initial retrieval implementation. Generated `tsvector` columns and GIN indexes rank active chunks without calling an embedding service. Chat depends on a retrieval interface rather than PostgreSQL SQL, so pgvector can be introduced as a new adapter while preserving workspace authorization, citations, HTTP contracts, and UI.

Document questions use the existing provider abstraction, rate limit, SSE stream, persistence, cancellation, and token accounting. Retrieved passages and bounded citation snapshots are attached to the pending assistant row before provider generation begins. If OpenAI is configured but unavailable, the request fails honestly; the development mock is never substituted.

See [`docs/PHASE_8_IMPLEMENTATION.md`](docs/PHASE_8_IMPLEMENTATION.md) for the complete lifecycle, trust boundaries, operational topology, and verification matrix.

## Usage management

Every generation reserves one request, a conservative input-token ceiling, the configured maximum output tokens, and—when an approved price exists—estimated cost inside the message-creation transaction. The external provider call runs after that transaction. Terminal persistence writes the immutable `UsageRecord` and settles the reservation from provider-returned token counts in one transaction. Concurrent requests serialize on a workspace-scoped PostgreSQL advisory lock, so they cannot all pass the same remaining quota.

Usage provenance is explicit. OpenAI records are `PROVIDER_REPORTED` only when the SDK response supplies valid non-negative input and output counts. The local/test provider is `DEVELOPMENT_ESTIMATE`. A failed or cancelled call without provider usage is `UNAVAILABLE`; it remains an attempted request but is not assigned fabricated token counts. Pre-provider quota rejections create neither a usage row nor chat messages.

No production prices ship in source or migrations. Operators import a reviewed price row with its provider model ID, unique version, effective window, rates in currency micro-units per one million tokens, and an HTTPS source URL. For example, the command shape is:

```bash
npm run pricing:import -- \
  --provider <provider> \
  --model <exact-provider-model> \
  --version <approved-version> \
  --input-micros-per-million <reviewed-integer> \
  --output-micros-per-million <reviewed-integer> \
  --effective-from <ISO-8601-timestamp> \
  --source-url <https-source>
```

The importer rejects overlapping effective windows. `--cached-input-micros-per-million`, `--effective-to`, `--supersedes-version`, and `--currency` are optional. When a vendor changes an open-ended price, `--supersedes-version` atomically closes that row at the new effective start and creates the new version; historical usage already contains its own immutable rate snapshot. A monetary quota fails closed with `pricing_unavailable` when the selected model has no active approved price.

Owners and Admins configure workspace-wide UTC-calendar-month quotas on `/usage`; Members can inspect the effective limits. Blank values mean unlimited and zero blocks that dimension. Raw API values use decimal strings to preserve PostgreSQL `BIGINT` precision. Estimated cost is an operational estimate, not an invoice.

See [`docs/PHASE_9_IMPLEMENTATION.md`](docs/PHASE_9_IMPLEMENTATION.md) for ledger semantics, price import rules, quota concurrency behavior, API visibility, and verification coverage.

## Controlled workflows

Owners and Admins create workflow shells, configure a graph, save immutable versions, and explicitly publish one active version. Members can inspect and run that published version but cannot author or publish. Each start resolves the active version server-side; clients cannot select a draft or historical definition. The execution stores a SHA-256 input digest, initiating user, version, and limit snapshot, then commits an outbox event before queue publication.

The initial registry supports only `INPUT`, `TEMPLATE`, `AI_PROMPT`, and `OUTPUT`. Templates perform two literal replacements (`{{input}}` and `{{previous}}`) and never evaluate expressions. AI nodes receive one bounded prompt through the existing provider abstraction with no tools. Validation rejects unknown fields/kinds, cycles, disconnected nodes, duplicate IDs/edges, invalid terminal connections, excessive graph size, and unavailable model aliases. No workflow configuration is used to select a module, function, URL, file path, query, package, or command.

`npm run worker:workflows` reloads the authoritative execution, version, workspace, and current membership; claims queued work with a compare-and-set transition; interprets nodes through the fixed registry; polls durable cancellation state; propagates abort signals; and atomically records a terminal state, safe log event, audit event, and notification. The bounded outbox pass also terminalizes wall-time-expired worker rows without replaying AI work. Logs contain node kind, timing, output length, model/usage metadata, and safe error codes—not prompts, workflow input/output, provider errors, credentials, or secrets. AI-node usage is reserved before queueing and settled only from the provider completion.

See [`docs/PHASE_11_IMPLEMENTATION.md`](docs/PHASE_11_IMPLEMENTATION.md) for the state machines, trust boundaries, endpoint inventory, deployment topology, and verification matrix.

## Platform administration

Platform administration is an independent control plane. Workspace Owner or Admin membership never grants access to `/admin` or `/api/v1/admin/**`, and a platform administrator receives no implicit access to ordinary workspace content. Every administrative request reloads the authoritative Better Auth session and database user, then requires an active `PlatformRole.ADMIN`, verified TOTP enrollment, and a session with recorded MFA assurance. Mutations additionally require same-origin/allowlisted-origin request metadata and MFA verification within the last ten minutes.

The console exposes aggregate platform health, safe account metadata, operational usage records, system activity, redacted audit events, and three allowlisted non-secret settings. User access changes use strong versions, revoke the target's sessions, protect the final active administrator, and refuse self-demotion or self-suspension. Administrator reads of sensitive metadata and all privileged mutations are audited. Denied platform-role, MFA, origin, and freshness checks are also recorded without request content.

Before the first administrator exists, an active verified user must enroll TOTP under `/settings/security`. Run the following from a controlled operator environment:

```bash
npm run admin:bootstrap -- \
  --email operator@example.com \
  --reason "Approved initial platform operator" \
  --confirm NEXUS-FIRST-ADMIN
```

The command holds a PostgreSQL advisory transaction lock, refuses to run if any active administrator exists, checks verified email and verified TOTP, revokes every target session, and writes a system audit event. The operator must then sign in again with password and TOTP. The same guarded command is the recovery path only when the active-administrator count is genuinely zero; there is no HTTP break-glass role grant, support impersonation, or silent tenant-content access.

See [`docs/PHASE_12_IMPLEMENTATION.md`](docs/PHASE_12_IMPLEMENTATION.md) for the permission boundary, data minimization rules, endpoints, settings, bootstrap process, and privilege-escalation verification matrix.

## Email outbox

Verification and recovery callbacks insert a deduplicated `auth.email.send` outbox event. Workspace invitations insert `workspace.invitation.email.send` in the same transaction as the invitation and audit record. Delivery marks the row `PUBLISHED` and replaces one-time URLs with non-sensitive metadata; failures retain the payload for retry, a redacted error code, and an exponential retry time. User-facing responses do not reveal account existence or SMTP status. Invitation credentials are SHA-256 digested in the invitation table and placed in the link fragment so they are not sent in the acceptance page's HTTP request URL.

For local development, Mailpit displays messages. In deployment, run `npm run outbox:dispatch` on a bounded recurring schedule. The same pass also retries document and workflow queue publication; processing itself runs in separately scalable BullMQ workers.

## Operational endpoints

| Endpoint                                                             | Contract                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/v1/health/live`                                            | Process liveness only. No database query.                                        |
| `GET /api/v1/health/ready`                                           | Minimal PostgreSQL readiness query.                                              |
| `GET\|PATCH /api/v1/me`                                              | Safe profile read and validated ETag update.                                     |
| `GET\|POST /api/v1/workspaces`                                       | List current memberships or atomically create a team workspace.                  |
| `GET\|PATCH\|DELETE /api/v1/workspaces/{workspaceId}`                | Membership-scoped detail, Admin rename, or Owner recoverable deletion.           |
| `POST /api/v1/workspaces/{workspaceId}/selection`                    | Persist the caller's active workspace preference after reauthorizing membership. |
| `POST /api/v1/workspaces/{workspaceId}/restoration`                  | Owner-only team-workspace restore during the recovery window.                    |
| `GET /api/v1/workspaces/{workspaceId}/members`                       | Membership-scoped member register.                                               |
| `PATCH\|DELETE /api/v1/workspaces/{workspaceId}/members/{userId}`    | Owner role update or policy-checked remove/self-leave.                           |
| `GET\|POST /api/v1/workspaces/{workspaceId}/invitations`             | Admin invitation history and enumeration-safe invitation creation.               |
| `DELETE /api/v1/workspaces/{workspaceId}/invitations/{invitationId}` | Policy-checked, ETag-protected revocation.                                       |
| `POST /api/v1/workspace-invitations/accept`                          | Email-bound, expiry-checked, replay-safe acceptance with the token in JSON.      |
| `POST /api/v1/workspaces/{workspaceId}/ownership-transfers`          | Owner-only serialized ownership transfer.                                        |
| `GET\|POST /api/v1/workspaces/{workspaceId}/conversations`           | Membership-scoped history or empty conversation creation.                        |
| `GET /api/v1/workspaces/{workspaceId}/conversations/{id}`            | Membership-scoped conversation metadata.                                         |
| `GET\|POST .../conversations/{id}/messages`                          | Persisted history or validated SSE generation.                                   |
| `GET .../conversations/{id}/messages/{messageId}`                    | Canonical persisted message for disconnect recovery.                             |
| `POST .../messages/{messageId}/regenerations`                        | New sibling assistant branch; never overwrites history.                          |
| `POST .../generations/{messageId}/cancellation`                      | Idempotent durable stop request, authorized to requester/Admin.                  |
| `GET /api/v1/workspaces/{workspaceId}/documents`                     | Authorized document list, filters, and indexed-content search.                   |
| `POST .../documents/upload-intents`                                  | Reserve quota and issue a five-minute private direct-upload grant.               |
| `GET\|PATCH\|DELETE .../documents/{documentId}`                      | Status/detail, creator/Admin rename, or soft-delete scheduling.                  |
| `POST .../documents/{documentId}/upload-completion`                  | Verify private object metadata and queue an immutable processing run.            |
| `POST .../documents/{documentId}/download-url`                       | Issue a 60-second authorized private download grant.                             |
| `POST .../documents/{documentId}/questions`                          | Retrieve active chunks and stream a persisted cited answer.                      |
| `GET /api/v1/usage/summary`                                          | Authorized aggregate by day, model, or operation for a bounded date range.       |
| `GET /api/v1/usage/records`                                          | Cursor ledger; Members see self, Owners/Admins see workspace records.            |
| `GET\|PATCH /api/v1/usage/quota`                                     | Effective UTC-month counters or ETag-protected Owner/Admin policy update.        |
| `GET\|POST .../workspaces/{workspaceId}/workflows`                   | Membership list or Owner/Admin draft creation.                                   |
| `GET\|PATCH\|DELETE .../workflows/{workflowId}`                      | Read, ETag metadata/lifecycle update, or recoverable deletion.                   |
| `GET\|POST .../workflows/{workflowId}/versions`                      | Version history or validated immutable version creation.                         |
| `POST .../versions/{versionId}/publication`                          | Owner/Admin activation of a validated version.                                   |
| `GET\|POST .../workflows/{workflowId}/executions`                    | Execution history or idempotent published-version start.                         |
| `GET .../workflow-executions/{executionId}/logs`                     | Increasing-sequence redacted execution events.                                   |
| `POST .../workflow-executions/{executionId}/cancellation`            | Requester/Admin cooperative cancellation.                                        |
| `GET /api/v1/admin/dashboard`                                        | MFA-backed aggregate platform posture and safe recent activity.                  |
| `GET /api/v1/admin/users`                                            | Audited cursor list and bounded account-metadata search.                         |
| `GET\|PATCH /api/v1/admin/users/{userId}`                            | Audited safe detail or ETag-protected role/status change.                        |
| `POST /api/v1/admin/users/{userId}/session-revocations`              | Fresh-MFA revocation of selected or all target sessions.                         |
| `GET /api/v1/admin/usage/summary`                                    | Platform aggregate by day, provider, model, or operation.                        |
| `GET /api/v1/admin/usage/records`                                    | Audited content-free operational usage ledger.                                   |
| `GET /api/v1/admin/activity`                                         | Unified safe audit, outbox, document, and workflow activity.                     |
| `GET /api/v1/admin/audit-logs`                                       | Filterable, cursor-paged, scrubbed security trail.                               |
| `GET /api/v1/admin/settings`                                         | Allowlisted non-secret settings with versions and ETags.                         |
| `PATCH /api/v1/admin/settings/{key}`                                 | Fresh-MFA, ETag-protected, key-schema-validated setting change.                  |

All product responses are private/no-store. Health responses disclose no provider, version, hostname, or topology details.

## Project structure

```text
.
├── docker/postgres/init/         Local test-database initialization
├── docs/                         Product, data, API, security, roadmap, and architecture contracts
├── prisma/
│   ├── migrations/               Reviewed forward SQL migrations
│   └── schema.prisma             Implemented Prisma model
├── scripts/
│   ├── dispatch-outbox.ts        Bounded email/provisioning/queue retry pass
│   ├── document-worker.ts        Long-lived BullMQ extraction/indexing worker
│   ├── workflow-worker.ts        Long-lived controlled workflow worker
│   ├── import-model-price.ts      Validated immutable model-price importer
│   ├── bootstrap-platform-admin.ts Guarded first/recovery administrator promotion
│   └── with-test-postgres.ts     Disposable PostgreSQL integration harness
├── src/
│   ├── app/                      App Router pages, route states, and handlers
│   ├── components/               Reusable layout and UI primitives
│   │   ├── dashboard/            Responsive authenticated workspace shell
│   │   ├── feedback/             Toast, skeleton, empty, and error states
│   │   ├── navigation/           Top navigation, product sidebar, and pagination
│   │   └── system/               Living component reference composition
│   ├── modules/
│   │   ├── auth/                 Better Auth client, server config, session DAL, auth UI
│   │   ├── administration/       Platform authorization, read models, mutations, validation, and console UI
│   │   ├── chat/                 Provider ports, streaming/finalization services, chat UI
│   │   ├── dashboard/            Tenant-scoped persisted dashboard read model
│   │   ├── documents/            Upload, extraction, retrieval, worker, routes, and UI
│   │   ├── usage/                Pricing, quota reservation, analytics, routes, and UI
│   │   ├── workflows/            Graph validation, lifecycle, execution worker, routes, and UI
│   │   └── workspaces/           Provisioning, lifecycle, policy, membership, and UI
│   ├── platform/                 Prisma, HTTP, mail, storage, and queue adapters
│   ├── shared/                   Domain-neutral validation primitives
│   └── styles/                   Global tokens/reset
└── tests/
    ├── e2e/                      PostgreSQL-backed black-box auth/isolation journey
    └── unit/                     Fast environment, validation, and rendering tests
```

## Quality gates

Run before merging:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run deploy:scan-client
npm run test:design-system
npm run test:integration
```

The integration command provisions a fresh PostgreSQL 18 cluster in a temporary directory, applies every migration, starts Next.js, and proves authentication, workspace management, chat, private document processing/search/Q&A/isolation, concurrent quota enforcement, usage privacy, MFA-backed administration, privilege-escalation resistance, and responsive product UI. Public browser checks cover landing-page accessibility, responsive overflow, and product metadata.

For the normal Docker path, `npm run test:e2e` expects the configured PostgreSQL service to already be available.

## Deployment

Follow [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md). It defines the supported topology, secret scopes, immutable container targets, managed PostgreSQL and private storage requirements, migration sequence, monitors, backup/restore drills, rollback decision tree, incident recovery, and final sign-off.

A production deployment must:

1. install with `npm ci`;
2. supply HTTPS application, PostgreSQL, SMTP, Better Auth, OpenAI, private S3-compatible storage, Redis, and ClamAV configuration;
3. apply `npm run db:deploy` as a controlled release step before serving incompatible code;
4. run `npm run build` and serve the resulting Next.js application;
5. run separately scalable `npm run worker:documents` and `npm run worker:workflows` processes;
6. schedule bounded `npm run outbox:dispatch` and `npm run account-deletions:process` executions;
7. probe `/api/v1/health/live` and `/api/v1/health/ready`, call `/api/v1/health/dependencies` with its monitoring credential, and monitor queue depth/failures;
8. terminate TLS before requests reach the application so production `Secure` cookies are accepted.

Database, SMTP, OpenAI, object-storage, and Redis secrets belong in the deployment secret manager, never in source, build logs, client bundles, or observability attributes. Before accepting production prompts or documents, approve provider retention/residency, malware-scanner operations, object lifecycle/versioning, parser resource isolation, a versioned price catalog/budget policy, and the target platform's streaming duration.

## Scope boundaries

The application does not yet add invoices, payments, subscription plans, automatic vendor-price synchronization, portable data exports, OCR, embeddings/pgvector, knowledge curation, external tools, approval nodes, loops, webhooks, support impersonation, or arbitrary integrations. Workflow execution intentionally has no general-purpose code or network node. The usage cost is an estimate derived from an operator-approved snapshot, not a billing amount. Workspace collaboration is fixed-role and workspace-visible; per-document ACLs, public sharing, presence, and real-time co-editing remain out of scope.

## Architecture documents

- [`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md)
- [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md)
- [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md)
- [`docs/API_SPECIFICATION.md`](docs/API_SPECIFICATION.md)
- [`docs/SECURITY_REQUIREMENTS.md`](docs/SECURITY_REQUIREMENTS.md)
- [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)
- [`docs/PHASE_2_IMPLEMENTATION.md`](docs/PHASE_2_IMPLEMENTATION.md)
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)
- [`docs/PHASE_4_IMPLEMENTATION.md`](docs/PHASE_4_IMPLEMENTATION.md)
- [`docs/PHASE_5_IMPLEMENTATION.md`](docs/PHASE_5_IMPLEMENTATION.md)
- [`docs/PHASE_6_IMPLEMENTATION.md`](docs/PHASE_6_IMPLEMENTATION.md)
- [`docs/PHASE_7_IMPLEMENTATION.md`](docs/PHASE_7_IMPLEMENTATION.md)
- [`docs/PHASE_8_IMPLEMENTATION.md`](docs/PHASE_8_IMPLEMENTATION.md)
- [`docs/PHASE_9_IMPLEMENTATION.md`](docs/PHASE_9_IMPLEMENTATION.md)
- [`docs/PHASE_10_IMPLEMENTATION.md`](docs/PHASE_10_IMPLEMENTATION.md)
- [`docs/PHASE_11_IMPLEMENTATION.md`](docs/PHASE_11_IMPLEMENTATION.md)
- [`docs/PHASE_12_IMPLEMENTATION.md`](docs/PHASE_12_IMPLEMENTATION.md)
- [`docs/PHASE_13_PRODUCTION_READINESS.md`](docs/PHASE_13_PRODUCTION_READINESS.md)
- [`docs/PHASE_14_IMPLEMENTATION.md`](docs/PHASE_14_IMPLEMENTATION.md)
- [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)
