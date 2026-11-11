# Phase 4 implementation: landing page and dashboard

**Status:** Implemented · **Last reviewed:** 2026-11-07

## Public landing page

The root route now provides the complete NEXUS product narrative:

- responsive product navigation, hero, product thesis, feature system, original interface studies, three-step process, call to action, and expanded footer;
- truthful availability language that separates the live identity/workspace foundation from planned chat, document, knowledge, and workflow capabilities;
- original interface artwork built with semantic HTML and CSS Modules rather than screenshots, stock imagery, or simulated product data;
- route metadata, canonical URL, Open Graph metadata, X card metadata, and a bespoke `public/og.png` social card;
- desktop, tablet, mobile, keyboard, reduced-motion, and automated WCAG A/AA coverage.

The landing page does not claim that AI generation, document processing, knowledge retrieval, or workflow execution is currently available.

## Authenticated dashboard

`/dashboard` remains protected by the Phase 2 server-side session and verified-account checks. The active personal workspace comes from durable provisioning state. `getDashboardData(userId, workspaceId)` then begins with the compound workspace membership lookup and performs every resource query with the authorized `workspaceId` predicate inside one repeatable-read transaction.

The dashboard renders:

- the signed-in user's persisted workspace name, kind, role, membership count, and creation time;
- actual provider-attempt count, input/output token totals, estimated cost, and storage usage;
- recent non-deleted conversations and documents from the active workspace only;
- persisted workspace audit events;
- accurate empty states when a resource table has no records;
- real links only for implemented routes; planned conversation and upload actions are visibly disabled.

No fallback fixtures, random chart values, synthetic activity, or hard-coded usage statistics are used by application code. Values of zero are database query results, not marketing placeholders. Estimated provider cost is explicitly labeled as an estimate rather than an invoice.

## Database additions

The additive Phase 4 migration introduces the approved root records needed for dashboard reads:

- `Conversation` with workspace scope, creator, lifecycle, recency, and recovery metadata;
- `Document` with workspace scope, creator, private storage metadata, processing state, size, and recovery metadata;
- `UsageRecord` with immutable provider-attempt identity, model/operation/status, token counters, pricing snapshot, cost estimate, and correlation metadata;
- `ConversationStatus`, `DocumentStatus`, and `UsageStatus` enums;
- tenant-first list indexes, uniqueness constraints, referential actions, non-negative accounting checks, and document lifecycle checks.

The migration does not add message generation, upload intents, object storage, extraction, or provider calls. Those behaviors remain governed by their later roadmap phases.

## Validation

Phase 4 acceptance includes:

- a fresh-database migration test;
- strict TypeScript, zero-warning ESLint, formatting, unit tests, and production build;
- landing-page accessibility and mobile overflow tests;
- a PostgreSQL-backed dashboard test that inserts real records for two users and proves each dashboard renders only its authorized workspace records;
- continued registration, verification, login, recovery, session, origin, ETag, logout, and cross-workspace API checks.
