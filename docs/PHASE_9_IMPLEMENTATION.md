# Phase 9 implementation: usage management

## Delivered scope

Phase 9 adds an authoritative usage ledger, explicit pricing coverage, atomic configurable workspace quotas, bounded analytics APIs, and a responsive usage surface. It does not add invoices, subscription plans, payments, automatic vendor-price synchronization, or platform-wide administration.

## Provider usage is authoritative

`UsageRecord` is written only in the terminal generation transaction. A record identifies the actual provider attempt, logical operation, workspace/user, provider/model, status, timestamps, token categories, pricing state, and safe diagnostic metadata.

- `PROVIDER_REPORTED`: the non-mock adapter received valid non-negative input and output counts in the provider response.
- `DEVELOPMENT_ESTIMATE`: the explicit local/test mock returned its deterministic estimate. This can never be confused with OpenAI usage.
- `UNAVAILABLE`: an actual provider attempt ended without usable token fields. Token columns remain numeric storage defaults, but provenance tells every consumer that they were not reported values.

OpenAI adapter usage is mapped from the Vercel AI SDK completion object. The browser cannot submit usage, price, provider, or model identifiers. Quota rejections occur before a provider call and create neither a usage row nor user/assistant messages.

## Pricing without invented values

No migration, source file, environment default, fixture used by production, or UI embeds vendor rates. `AiModelPrice` stores an operator-reviewed immutable version with an exact provider model ID, currency, input/cached-input/output rates in currency micro-units per one million tokens, effective window, and HTTPS source URL.

Use `npm run pricing:import -- ...` to create a row. The importer requires explicit rates/source/effective start and rejects overlapping windows. `--supersedes-version` atomically closes an open price at the new effective start while creating its successor. Historical `UsageRecord` rows snapshot the applied version and rates so later catalog-window maintenance cannot rewrite old estimates.

Cost arithmetic uses integers only. Cached input is charged at the configured cached rate, or the input rate when a distinct cached rate is absent. Output tokens include any provider-reported reasoning-token subset and are not double-counted. The final numerator is rounded upward to the nearest currency micro-unit, which makes quota enforcement conservative. Every UI cost says “estimated”; it is not an invoice.

The official provider pricing page is the operational source to review before importing a row: [OpenAI API pricing](https://openai.com/api/pricing/). Provider usage fields are documented in the [OpenAI Responses API reference](https://platform.openai.com/docs/api-reference/responses/object#responses/object-usage). Import review, not a network scraper, remains the trust boundary.

## Reservation and reconciliation

Each workspace has a versioned `WorkspaceUsagePolicy`. Each UTC calendar month gets one `UsageQuotaPeriod` containing a policy snapshot and consumed/reserved counters. A `UsageReservation` links a logical generation to that period and, when available, the exact price row selected at reservation time.

Generation follows this sequence:

1. Reauthorize membership and validate the model/request.
2. In the same short transaction that creates the messages, acquire conversation- and workspace-usage-scoped PostgreSQL advisory locks. `READ COMMITTED` lets a lock waiter observe the preceding committed counters; atomic SQL updates and the locks provide the invariants without stale serializable snapshots.
3. Release expired reservations, snapshot the current policy, and reserve one request, a conservative UTF-8/framing input ceiling, the configured maximum output tokens, and estimated cost when priced.
4. Commit before contacting the provider.
5. Stream outside a database transaction.
6. In the terminal message/usage transaction, write the immutable ledger row and atomically move the actual provider amounts from reserved to consumed.

If a cost limit exists and no effective approved price exists for the selected model, reservation fails closed with `503 pricing_unavailable`. Token reservations are intentionally conservative and are not written as usage. Actual provider response values are the only values settled into token consumption. A terminal attempt without usage still consumes one request, releases token/cost reservations, and records `UNAVAILABLE` provenance.

## Authorization and API

- `GET /api/v1/usage/summary`: membership-scoped workspace aggregates, bounded to 366 days and grouped by `day`, `model`, or `operation`.
- `GET /api/v1/usage/records`: Owners/Admins receive workspace records; Members receive only their own records. Cursors bind workspace and visibility scope.
- `GET /api/v1/usage/quota`: any member can inspect limits, consumed, reserved, remaining, period, and reset time.
- `PATCH /api/v1/usage/quota`: Owner/Admin only, trusted origin, strict JSON, current ETag, decimal strings or `null`, and an audit event.

All endpoints are authenticated, email-verified, provisioned, private/no-store, Zod-validated, and tenant-scoped. Raw prompts, document text, credentials, and provider payloads are absent from usage responses.

## User interface

`/usage` provides real rolling-30-day metrics, a CSS-rendered daily input/output chart, explicit price coverage, usage provenance, current monthly quota counters, Owner/Admin quota controls, and privacy-scoped recent ledger rows. It includes responsive desktop/tablet/mobile layouts plus route loading and error boundaries. The main dashboard retains a persisted 30-day snapshot and links to the detailed surface.

## Verification

- Unit tests cover exact rate snapshots, cached-input behavior, missing cached rates, conservative micro-unit rounding, and invalid negative usage.
- Existing chat integration tests cover successful generation, regeneration/retry-like logical attempts, cancellation, persistence, and mock provenance.
- Phase 9 integration coverage runs concurrent requests against a one-request quota and proves exactly one succeeds; counters settle to the immutable ledger and reserved counters return to zero.
- Integration coverage proves Member raw records exclude an Owner's usage, anonymous access is rejected, Member policy mutation is denied, stale ETags fail, and monetary quota enforcement fails closed when pricing is unavailable.
- The full quality gate runs formatting, lint, strict type checking, production build, unit tests, clean-database migrations, and all browser/integration tests.

## Deferred operations

A scheduled reconciliation report comparing period counters to immutable ledger aggregates, platform-admin price/quota interfaces, vendor price synchronization, invoices, billing plans, and payment processing remain deferred. Before production launch, operations must approve price sources, effective windows, currency, model aliases, quota values, and retention rules.
