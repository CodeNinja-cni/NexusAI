# Phase 6 implementation — AI provider integration and chat engine

**Implemented:** 2026-11-08  
**Runtime scope:** Next.js Node.js route handlers, PostgreSQL, Vercel AI SDK, OpenAI or explicit development mock

## Outcome

Phase 6 adds a complete vertical chat path: an authenticated workspace member can create a conversation, submit a validated message, receive a server-originated SSE stream, stop it, reload persisted history, select an enabled model alias, and regenerate an assistant response as a new branch. Assistant content, terminal state, provider/model snapshot, and usage are canonical database records.

OpenAI is the initial real provider. Its API key stays in server environment state. The deterministic mock is available only when `APP_ENV` is `local` or `test` and `AI_PROVIDER=mock`; it identifies itself in the model catalog, response body, UI, and usage metadata. There is no provider fallback path.

## Configuration decisions

1. **Stable provider port.** Product services depend on `AiProvider`, not OpenAI or AI SDK types. The OpenAI adapter owns `createOpenAI` and `streamText`; the mock implements the same normalized stream contract.
2. **Stable application model aliases.** Clients select `openai/nexus-core` or, in local/test only, `mock/nexus-dev`. They cannot submit a provider base URL, raw model identifier, or credential. `AI_OPENAI_MODEL` maps the OpenAI alias to a deployed provider model.
3. **No silent fallback.** `AI_PROVIDER=openai` requires `OPENAI_API_KEY`. Provider setup/network failures produce an RFC 9457 pre-stream problem or `generation.error` after headers. Mock output is never substituted.
4. **NEXUS-owned SSE.** The public wire protocol uses `generation.started`, `message.delta`, `generation.completed`, `generation.cancelled`, `generation.error`, and `heartbeat`. It does not expose an unstable provider event format.
5. **Cancellation over replay.** The initial version supports abort/stop and persisted reconciliation. It does not enable automatic SSE resumption because AI SDK documents stream resumption and abort as incompatible.
6. **Durable generation state.** User and pending assistant rows commit before provider work. A cancellation request commits `CANCEL_REQUESTED` before signalling. Completion/failure/cancellation and usage settle transactionally.
7. **Atomic message order.** `Conversation.nextMessageSequence` is incremented in the same short transaction that holds the conversation advisory lock and inserts attempts. No unlocked `MAX(sequence)+1` query exists.
8. **Branch-preserving regeneration.** A regenerated assistant message shares the original user parent and records `supersedesMessageId`. Existing output is immutable history.
9. **Database-backed coordination.** Atomic PostgreSQL minute buckets enforce independent user and workspace limits. Durable message-state polling observes cancellation across instances. The in-process abort registry is latency optimization only.
10. **Bounded provider work.** OpenAI uses a total/chunk timeout, two retry attempts inside AI SDK, a server-set output-token ceiling, the request abort signal, and `providerOptions.openai.store=false`.
11. **Truthful accounting.** OpenAI token counts come from provider usage. Mock counts are labelled `deterministic_mock_estimate`. Provider cost remains zero with an `unpriced` pricing version until a governed price catalog is approved; the product does not fabricate spend.
12. **Safe rendering.** `react-markdown` renders GFM and `rehype-highlight` annotates code. Raw HTML support is not enabled, so model text cannot inject active HTML through the Markdown renderer.
13. **Strict request boundary.** Zod objects are strict, content is bounded to 32,000 characters, IDs must be UUIDs, model aliases are allowlisted, mutations require trusted origin and UUID v4 `Idempotency-Key`, and every nested lookup carries the workspace/conversation boundary. Conversation creation uses that key as its deterministic resource ID, so a retry returns the same row; message/regeneration domain IDs prevent duplicate attempts and direct clients to reconcile persisted state rather than replaying a stream.

## Persistence model

The Phase 6 migration adds:

- `MessageRole` and `MessageStatus` enums;
- `messages`, including tenant/conversation composite references, branch parents, supersession, domain idempotency IDs, provider snapshots, safe errors, cancellation actor/time, and terminal timestamps;
- partial unique indexes for client message/generation IDs;
- `Conversation.nextMessageSequence` and a tenant-safe active-leaf foreign key;
- `usage_records.message_id` relation;
- `ai_rate_limit_buckets` with an atomic `(key, window_started_at)` primary key.

The database enforces user-message terminal state, client-ID/role coherence, cancellation metadata coherence, same-conversation parent/supersedes references, and same-workspace conversation/message ownership.

## Request lifecycle

1. Resolve the Better Auth database session and ready account.
2. Validate trusted origin, idempotency header, route UUIDs, and strict JSON body.
3. Reauthorize workspace membership by `(workspaceId, userId)`.
4. Resolve the enabled application model alias.
5. Atomically consume both user and workspace rate-limit buckets.
6. In a short `READ COMMITTED` transaction holding the conversation advisory lock, reject another active generation, allocate sequence numbers, insert the completed user plus pending assistant rows, and reserve workspace usage under the usage lock.
7. Load only the canonical parent chain from PostgreSQL and normalize it to provider prompt messages.
8. Open the provider stream with abort/time/output bounds; emit normalized SSE and checkpoint text in bounded batches.
9. Poll durable message state for cross-instance stop requests while the local registry handles same-process stops immediately.
10. Finalize message, active leaf, usage, and safe terminal state in PostgreSQL. The browser reconciles via the message GET route after a disconnect.

## Routes

All paths below are beneath `/api/v1/workspaces/{workspaceId}` and require a verified, provisioned session plus current workspace membership.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/conversations` | Bounded recent history for the workspace. |
| `POST` | `/conversations` | Create an empty conversation with an enabled model alias. |
| `GET` | `/conversations/{conversationId}` | Read tenant-scoped metadata. |
| `GET` | `/conversations/{conversationId}/messages` | Read up to 100 persisted user/assistant rows in sequence order. |
| `POST` | `/conversations/{conversationId}/messages` | Persist user/assistant attempts and stream SSE. |
| `GET` | `/conversations/{conversationId}/messages/{messageId}` | Read canonical status/content after disconnect. |
| `POST` | `/conversations/{conversationId}/messages/{messageId}/regenerations` | Create and stream a sibling assistant branch. |
| `POST` | `/conversations/{conversationId}/generations/{messageId}/cancellation` | Persist and signal an idempotent stop request. |

## Environment variables

| Variable | Default/requirement |
| --- | --- |
| `AI_PROVIDER` | `mock` in local/test; defaults to `openai` elsewhere. |
| `OPENAI_API_KEY` | Required when `AI_PROVIDER=openai`; server only. |
| `AI_OPENAI_MODEL` | `gpt-5-mini`; actual model behind the stable alias. |
| `AI_REQUEST_TIMEOUT_MS` | `60000`, allowed 5,000–300,000. |
| `AI_MAX_OUTPUT_TOKENS` | `2048`, allowed 64–32,768. |
| `AI_REQUESTS_PER_MINUTE` | `12`, allowed 1–1,000 per user and per workspace. |
| `AI_MOCK_CHUNK_DELAY_MS` | `18`, local/test stream pacing. |

## Files created

### Database and documentation

- `prisma/migrations/20261108170000_phase_6_chat_engine/migration.sql`
- `docs/PHASE_6_IMPLEMENTATION.md`

### App Router pages and states

- `src/app/chat/page.tsx`
- `src/app/chat/[conversationId]/page.tsx`
- `src/app/chat/loading.tsx`
- `src/app/chat/error.tsx`

### Route handlers

- `src/app/api/v1/workspaces/[workspaceId]/conversations/route.ts`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/[conversationId]/route.ts`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/[conversationId]/messages/route.ts`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/[conversationId]/messages/[messageId]/route.ts`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/[conversationId]/messages/[messageId]/regenerations/route.ts`
- `src/app/api/v1/workspaces/[workspaceId]/conversations/[conversationId]/generations/[messageId]/cancellation/route.ts`

### Chat server module

- `src/modules/chat/server/provider.ts`
- `src/modules/chat/server/model-catalog.ts`
- `src/modules/chat/server/providers/openai-provider.ts`
- `src/modules/chat/server/providers/mock-provider.ts`
- `src/modules/chat/server/chat-service.ts`
- `src/modules/chat/server/generation.ts`
- `src/modules/chat/server/generation-registry.ts`
- `src/modules/chat/server/rate-limit.ts`
- `src/modules/chat/server/route-support.ts`
- `src/modules/chat/server/serialization.ts`
- `src/modules/chat/server/validation.ts`

### Chat interface

- `src/modules/chat/components/chat-index.tsx`
- `src/modules/chat/components/chat-index.module.css`
- `src/modules/chat/components/chat-experience.tsx`
- `src/modules/chat/components/chat-experience.module.css`

### Verification

- `tests/e2e/chat.spec.ts`
- generated Prisma model outputs for `Message` and `AiRateLimitBucket` under `src/generated/prisma/`

## Files updated

- `prisma/schema.prisma`
- `package.json` and `package-lock.json`
- `.env.example`
- `src/platform/env/schema.ts`
- `src/components/dashboard/dashboard-shell.tsx`
- `src/components/ui/dropdown-menu.tsx` (made menu-item focus deterministic for the full regression gate)
- `src/app/dashboard/page.tsx`
- `src/proxy.ts`
- `tests/unit/environment.test.ts`
- `playwright.config.ts`
- `scripts/with-test-postgres.ts`
- `README.md`
- `docs/DEVELOPMENT_ROADMAP.md`
- `docs/SYSTEM_ARCHITECTURE.md`

## Verification coverage

The Phase 6 browser integration test provisions two verified accounts and proves:

- authentication is required;
- unknown JSON fields are rejected;
- conversation creation and mock SSE started/delta/completed events;
- conversation-create idempotency produces one row across a replay;
- canonical user/assistant persistence and non-zero usage;
- regeneration creates a sibling branch;
- stop produces durable `CANCELLED` state and a cancellation event;
- a saturated atomic user bucket returns `429` with `Retry-After` before persistence;
- a second account receives cross-tenant `404` responses;
- the mobile chat studio has no horizontal overflow.

The full integration harness applies every migration to a fresh PostgreSQL 18 cluster before starting the production Next.js build. A live OpenAI call is deliberately excluded from ordinary CI to avoid paid, nondeterministic tests; it remains a protected staging acceptance check.

## Remaining production gates

- Run a credentialed OpenAI contract test in protected staging and confirm the selected model supports the configured settings.
- Approve OpenAI retention, residency, and commercial terms before real customer prompts.
- Add a versioned provider price catalog, budget/quota reservation policy, and reconciliation job before presenting monetary estimates as meaningful.
- Load-test PostgreSQL rate buckets and cancellation polling; cut coordination to managed Redis if the reviewed latency/contention envelope is exceeded.
- Add a stale-generation reconciler/sweeper for process death after the pending row commits.
- Complete Phase 7 pagination, search, rename/archive/delete/restore, long-thread virtualization, copy interactions, and adversarial Markdown fixtures.

## Primary references

- [Vercel AI SDK `streamText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)
- [AI SDK resumable streams and abort limitation](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
