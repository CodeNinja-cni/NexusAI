# Phase 13 production-readiness review

**Review date:** 2026-11-08  
**Decision:** **NOT READY FOR PRODUCTION**

The application compiles, the Prisma schema and migration history validate, dependency vulnerability audits report no known vulnerabilities, and the complete local unit and PostgreSQL-backed browser suites pass. The review also closed concrete authorization, integrity, validation, error-disclosure, transport, accessibility, and bounded-work defects.

Production approval is still blocked. NEXUS does not yet enforce the required Content Security Policy, untrusted document parsing is not isolated from the worker host, production-like storage/scanner/queue/provider controls have not been exercised, disaster-recovery and operational drills have not been completed, and the independent deep-security scan produced no review coverage because its discovery workers failed before analysis. These are release gates, not post-launch cleanup.

## Review method and limits

The review covered source, configuration, migrations, local dependency metadata, unit tests, and black-box application behavior against a newly created PostgreSQL 18 cluster. It included authentication, authorization, tenant isolation, database constraints, API validation, document handling, provider boundaries, workflow execution, safe errors, performance bounds, responsive layout, keyboard behavior, and automated WCAG A/AA checks.

No production or staging services were available. Consequently, this review did not validate a managed PostgreSQL topology, TLS termination, SMTP delivery, OpenAI behavior, S3 bucket policies, Redis security, ClamAV operations, worker supervision, backup restoration, alert delivery, or deployment rollback.

The Codex Security deep-scan workflow was also invoked. Scan `07c53ad5-2c6c-41d8-8701-55d1411e549a` failed before finding discovery after three unsuccessful workers. The stable failure was:

```text
Deep Scan stopped after 3 consecutive unsuccessful discovery workers (limit: 3);
last failure (transient_error): Codex Exec exited with code 2:
error: unexpected argument '--thread-source' found
```

The failed scan reviewed 0 of 356 files and returned no findings. Zero findings from that run is not evidence of security; an independent scan or penetration test remains mandatory.

## Remediation completed in Phase 13

| Area | Change | Verification |
| --- | --- | --- |
| API error disclosure | Unknown profile, workspace, and notification failures now return a generic private `500` problem response with a correlation ID. Exception text is not returned to the caller. | Unit response test and integration regression suite |
| Workspace ownership | Added a deferred PostgreSQL invariant requiring exactly one `OWNER` membership matching `workspaces.owner_user_id` at transaction commit. | Direct database corruption attempt is rejected and rolled back |
| Workflow authorization | The worker reauthorizes the requester, membership, workspace, workflow, and execution before every node. Revocation cancels the execution with a stable code. | Live membership-revocation integration journey |
| Document grants | Upload grants are limited to 300 seconds and download grants to 60 seconds. | Integration assertions compare actual expiry timestamps |
| AI context bounds | Message-branch loading is tenant-scoped, recursive, and limited to 100 messages; total prompt characters are capped by validated environment configuration. | Unit validation plus chat integration suite |
| Request validation | Collection query schemas reject unknown parameters instead of silently ignoring them. Routes parse the complete query map. | Unit schema tests and authenticated API integration assertion |
| Deployed transport | Deployed PostgreSQL requires an SSL mode, Redis requires `rediss:`, S3 endpoints require HTTPS, and non-implicit SMTP enables required TLS with TLS 1.2 minimum. | Environment unit tests |
| Browser isolation | Added `Cross-Origin-Resource-Policy: same-origin` alongside existing security headers. | Browser header assertions, including absence of permissive CORS |
| Administration performance | User detail usage totals are calculated in PostgreSQL rather than loading an unbounded ledger. Expired sessions are excluded and old admin rate-limit buckets are pruned. | Type, lint, build, and admin integration suite |
| Accessibility | Added authenticated Axe checks and mobile overflow checks for dashboard, profile settings, and workspace management. | PostgreSQL-backed Playwright suite |

## Review results

### Authentication and sessions

Better Auth uses database sessions, required email verification, single-use password recovery, secure deployed cookies, origin checks, and server-side revocation. Registration, verification, login, logout, recovery, two-factor administration access, and protected-route behavior are covered by integration journeys. Generic auth errors avoid intentional account enumeration.

Remaining work: exercise real SMTP delivery and bounce behavior in staging; test reverse-proxy origin/header handling; confirm production cookie behavior at the final canonical domain; load-test authentication abuse controls; and complete Better Auth/version upgrade monitoring.

### Authorization and tenant isolation

Workspace permissions are evaluated server-side near each data query. Tenant routes use workspace-scoped identifiers and return denial-safe responses. Tests cover cross-user profile privacy, cross-workspace dashboard/chat/document/workflow/usage access, ordinary-user administration denial, privilege escalation, and permission revocation during a workflow run.

The database now enforces the most important workspace Owner invariant. Application-scoped authorization is still the primary tenant boundary; PostgreSQL row-level security is not enabled. A staging connection-pooling/RLS decision and adversarial IDOR review remain required.

### Database integrity

The Prisma schema validates and all 11 forward migrations apply to an empty PostgreSQL 18 database. Composite tenant relationships, uniqueness constraints, optimistic versions, quotas, idempotency, outbox state, and deferred ownership checks provide substantial integrity protection.

Open operational work includes restore testing, point-in-time recovery evidence, failover/connection-pool testing, migration rollback rehearsal, purge-versus-restore race tests, and verification that all retention schedules are actually executed.

### API and input security

JSON content types and body limits are enforced, Zod schemas are strict on reviewed request/query surfaces, cursors and identifiers are validated, mutations use CSRF/origin protection, and response errors are correlation-safe. API keys remain server-only. Security headers include HSTS in production, no-sniff, referrer policy, frame denial, COOP, CORP, and a restrictive permissions policy.

The required enforced CSP is absent. The current UI uses numerous inline style attributes, including dynamic workflow-canvas geometry; deploying a strict CSP now would break those surfaces. Styles must be refactored to nonce-compatible style elements or approved classes, then an enforced, tested CSP and reporting endpoint must be introduced. Per-IP abuse protection and trusted-proxy semantics also require production validation.

### Document security

Documents use private storage, short grants, exact declared size/type checks, SHA-256 verification, quarantine states, structural validation, format-specific bounds, deployed ClamAV requirements, authorized downloads, and tenant-isolation tests. Retrieval remains workspace/document scoped.

Untrusted PDF and DOCX parsing still runs inside the document worker process without an independently enforced OS/container memory, CPU, process, filesystem, or egress sandbox. Production bucket public-access blocks, encryption, lifecycle/versioning, CORS, signed-request constraints, scanner fail-closed behavior, and malformed-file corpus testing have not been proven in staging.

### AI provider integration and usage

The provider interface separates OpenAI from the explicit local/test mock. OpenAI credentials are server-only, provider errors do not fall back to fake success, generation can be cancelled, context is bounded, models are allowlisted, and provider-reported usage is the only source of production token records. No price is invented when an approved price snapshot is absent.

No real OpenAI call was made during this review. Provider retention, regional processing, model approval, usage-field compatibility, streaming timeout behavior, and legal/privacy acceptance remain deployment prerequisites.

### Workflow execution

The controlled engine accepts only four declarative node kinds, rejects arbitrary code/network nodes and cycles, validates graph size, enforces concurrency/step/time/input/output ceilings, records immutable versions and audit logs, and reauthorizes before every node. Cancellation and authorization revocation have black-box coverage.

Worker crash recovery, lease/heartbeat behavior under long provider calls, queue outage recovery, retry/redelivery idempotency, and sustained concurrency limits need failure-injection and load evidence in a production-like environment.

### Error handling and observability

Reviewed APIs return structured, non-cacheable problem responses without stack traces or exception messages. Correlation IDs survive internal errors. Audit and activity records exist for security-relevant domain and admin operations.

Central log transport, sensitive-field filtering in the actual platform, alert routing, SLOs, dashboards, trace sampling, queue alarms, incident runbooks, and on-call ownership are not yet operationally proven.

### Performance

The review removed an unbounded admin ledger read and an unbounded chat-history read. Pagination, bounded bodies, rate buckets, worker concurrency, document limits, query indexes, and server-first rendering reduce obvious exhaustion risks.

No representative load test has established latency or saturation targets. Search scale, concurrent streams, quota contention, cold starts, large workspaces, connection exhaustion, queue backlogs, and storage throughput remain unmeasured. The PostgreSQL driver emits an overlapping-query deprecation warning that must be resolved before upgrading to `pg` 9.

### Accessibility

Public and authenticated Axe scans pass the configured WCAG 2 A/AA rules. Keyboard dialog/navigation behavior, focus handling, mobile layouts, and horizontal overflow are tested on key surfaces.

Automated scans are not a substitute for manual assistive-technology review. Screen-reader journeys, zoom/reflow at 200%/400%, high-contrast mode, reduced-motion behavior across all dynamic surfaces, and supported-browser testing remain required.

## Verification evidence

| Command | Result |
| --- | --- |
| `npx prisma validate --config prisma7.config.ts` | Passed; schema valid |
| `npm run format:check` | Passed after formatting three changed files |
| `npm run lint` | Passed with zero warnings |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 11 files, 45 tests |
| `npm run test:integration` | Passed: 11 migrations and 17 Playwright tests against fresh PostgreSQL 18 |
| `npm run build` | Passed; optimized Next.js production build completed |
| `npm audit --omit=dev --audit-level=low` | Passed: 0 vulnerabilities |
| `npm audit --audit-level=low` | Passed: 0 vulnerabilities |
| secret-pattern scan | No OpenAI, AWS, or private-key patterns found in the reviewed workspace |
| `npm audit signatures` | **Failed:** expired registry signature key for `server-only@0.0.1` (`EEXPIREDSIGNATUREKEY`) |
| Codex Security deep scan | **Failed before discovery:** 0/356 files reviewed |

The integration run logged the current `pg` 8 warning that overlapping `client.query()` calls will be unsupported in `pg` 9. Expected negative authentication tests also produce a server-side auth error log. Neither caused a test failure.

## Outstanding release risks

### Critical release blockers

1. **No enforced Content Security Policy.** This fails the approved security acceptance gate and leaves an important XSS containment layer absent.
2. **Untrusted parsers are not sandboxed.** A malicious parser exploit or resource-exhaustion file could affect the document worker host.
3. **Independent security review has no coverage.** The attempted deep scan failed before analysis; penetration testing or a repaired independent scan is required.
4. **Production-like security controls are unverified.** Private S3 policy, encryption/lifecycle, ClamAV fail-closed behavior, Redis isolation, managed-database TLS/pooling, and provider data handling need staging evidence.
5. **Recovery and operations are unproven.** Backup restore, RPO/RTO, rollback, failover, alerting, incident response, and worker supervision have not been drilled.

### High-priority risks

- No committed CI workflow or protected-branch evidence runs the required gates, frozen-lock install, secret scan, migration test, and browser suite on each change.
- `npm audit signatures` cannot currently establish a complete registry-signature chain because the `server-only@0.0.1` signing key is expired.
- Per-IP abuse controls and trusted reverse-proxy header handling have not been proven for authentication, generation, uploads, or administrative endpoints.
- Provider retention/residency, approved model behavior, and real usage reporting remain untested and unapproved.
- Worker crash/redelivery, queue loss, long-running execution leases, deletion/purge races, and outbox recovery lack failure-injection evidence.
- Database row-level security is deferred, so a missed tenant predicate can still become a data-boundary defect.

### Medium-priority risks

- No representative load/soak results or approved capacity/SLO thresholds exist.
- Manual screen-reader, zoom/reflow, high-contrast, and cross-browser accessibility verification remains outstanding.
- The current `pg` overlapping-query warning is a future compatibility risk.
- Readiness probes do not prove every worker, queue, scanner, object-store, mail, or provider dependency is healthy.
- Supply-chain SBOM, build provenance, deployment attestation, and dependency exception workflow are not implemented.

## Required evidence before Phase 14 approval

1. Refactor inline style usage and pass an enforced CSP/header test without broad `unsafe-inline` or `unsafe-eval` allowances.
2. Run document extraction in a hardened, unprivileged, resource-limited, no-egress sandbox and validate a hostile-file corpus.
3. Repair the independent scan tooling, run a complete review, triage all results, and obtain penetration-test sign-off for identity, IDOR, upload, workflow, and admin paths.
4. Deploy an isolated staging stack and prove PostgreSQL TLS/pooling, S3 privacy/encryption/lifecycle, Redis TLS/auth, ClamAV fail-closed behavior, SMTP, OpenAI error/usage semantics, workers, and proxy headers.
5. Add mandatory CI with `npm ci`, formatting, lint, type checks, unit/integration/browser tests, migration-from-empty, dependency/secret scanning, an SBOM, and provenance.
6. Complete load, queue-outage, provider-timeout, worker-crash, quota-race, purge/restore, backup/restore, rollback, failover, alert, and incident-response drills against approved targets.
7. Resolve or document the registry-signature failure and the `pg` warning with owners and deadlines.
8. Record security, privacy/legal, accessibility, SRE/on-call, and launch-owner approvals.

Until these gates have evidence, local test success must not be represented as production readiness.
