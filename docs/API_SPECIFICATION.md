# NEXUS AI API Specification

- Status: Phase 0 contract
- Style: versioned JSON HTTP API implemented with Next.js App Router route handlers
- Base path: `/api/v1`
- Last reviewed: 2026-11-07

This document defines the public product contract and its security semantics. It does not create route handlers. The repository was empty when this contract was written. Phase 1 must pin current stable dependencies and verify every framework integration against official documentation before implementation.

## 1. Contract boundaries

- Product endpoints live below `/api/v1` and are implemented as `src/app/api/v1/**/route.ts` route handlers using the Web `Request`/`Response` APIs.
- Browser page routes such as `/features`, `/dashboard`, and `/chat/[id]` are not API endpoints. Server Components may call the same service layer directly where that avoids an unnecessary loopback HTTP request, but they must enforce the same authorization policy.
- Unless explicitly public, endpoints require a valid Better Auth session cookie. Authentication is cookie-based; bearer-token access for third-party clients is not part of v1.
- JSON is `application/json; charset=utf-8`. Errors are `application/problem+json`. Streams are `text/event-stream; charset=utf-8`. File bytes go directly between the client and private S3-compatible storage through short-lived signed URLs.
- IDs are opaque UUID strings. Dates are RFC 3339 UTC strings. Token counts and byte counts that may exceed JavaScript's safe integer range are decimal strings in JSON. Monetary amounts are integer micros encoded as decimal strings plus a currency code.
- v1 accepts and returns `camelCase` JSON while PostgreSQL uses `snake_case` mappings.
- Route handlers that use Prisma, AI providers, or document libraries run in the supported Node.js runtime. Do not assume edge-runtime compatibility.

## 2. Versioning and compatibility

- A breaking request/response or behavior change requires `/api/v2`. Adding an optional response field, a new endpoint, a new error code, or a new enum value is additive; clients must ignore unknown response fields and handle unknown enum values defensively.
- Requests reject unknown input fields by default. A server may add optional inputs without making older clients invalid.
- Deprecated endpoints remain available for a documented migration window and emit standard `Deprecation`, `Sunset`, and `Link` headers where supported.
- The API version does not select an AI provider model version. Persist the provider/model snapshot with each generated message and usage record.

### Better Auth is deliberately outside `/api/v1`

Better Auth is mounted at the library-recommended catch-all route:

```text
/api/auth/[...all]
```

The Next.js adapter owns the `GET` and `POST` behavior under that path. Registration, login, logout, email verification, password recovery/change, email change, account linking, and session management use the installed Better Auth client's methods and generated endpoint contract. Those operations are not REST resources designed by NEXUS AI, are not wrapped in the response envelope below, and must not be copied into this document as guessed paths or bodies. Pin Better Auth, generate/diff its database schema, restrict trusted origins, and smoke-test the exact flows on every upgrade. Product code should use the typed Better Auth client/server API rather than hand-building its internal URLs.

NEXUS AI owns account-deletion orchestration because it must transfer/delete workspaces and purge object storage; the authenticated `/api/v1/me/deletion-request` endpoints below coordinate with Better Auth to revoke sessions and ultimately delete the auth user.

## 3. Common HTTP contract

### 3.1 Request headers

| Header | Requirement |
| --- | --- |
| `Content-Type: application/json` | Required for JSON bodies; otherwise `415`. |
| `Accept: application/json` | Default for ordinary endpoints. |
| `Accept: text/event-stream` | Required for generation/question streaming endpoints; otherwise `406`. |
| `Idempotency-Key` | Required on the mutating create/action endpoints marked **I**. Printable ASCII, 16–128 characters, generated per logical operation. |
| `If-Match` | Required on versioned `PATCH`/`DELETE` endpoints marked **E**. Value is the last strong entity tag returned by the API. |
| `X-Request-Id` | Optional client correlation ID. It must be 1–100 safe ASCII characters; the server generates a new ID if absent/invalid. It is never trusted for uniqueness. |

Cookies and `Origin` are sent by the browser. Request JSON never contains `userId`, platform role, workspace role, or another actor identity unless an administrator endpoint explicitly names its target in the path.

### 3.2 Successful responses

Single resource:

```json
{
  "data": {
    "id": "018f...",
    "name": "Research",
    "version": 3,
    "createdAt": "2026-11-07T09:30:00.000Z",
    "updatedAt": "2026-11-07T10:00:00.000Z"
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

Collection:

```json
{
  "data": [],
  "page": {
    "limit": 20,
    "nextCursor": null,
    "hasMore": false
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

- `200` reads and ordinary updates, `201` creations, `202` accepted asynchronous/cancellation/deletion work, and `204` successful operations with no representation.
- Creation responses include `Location` where a stable resource URL exists.
- Mutable resource responses include a strong `ETag` derived from resource ID and integer version, not from a serialization that may change. Collection items whose mutations require **E** also include the corresponding `etag` value in JSON, so a client never has to invent an `If-Match` value from a collection-level header.
- Authenticated, signed-URL, and stream responses send `Cache-Control: private, no-store`. Public configuration may use explicit short-lived cache headers. Never cache a response that sets session cookies in a shared cache.

### 3.3 Error responses

Errors follow RFC 9457 Problem Details with stable NEXUS AI extensions:

```json
{
  "type": "https://nexus.example/problems/validation-error",
  "title": "Request validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/api/v1/workspaces",
  "code": "validation_error",
  "requestId": "req_...",
  "errors": [
    {
      "path": "name",
      "code": "too_long",
      "message": "Name must contain at most 120 characters."
    }
  ]
}
```

`detail` and field messages are safe for the caller; internal exceptions, SQL text, provider bodies, storage keys, tokens, stack traces, and existence of inaccessible resources are not returned.

| Status | Stable use |
| --- | --- |
| `400` | malformed JSON/query/cursor or semantically impossible command |
| `401` | no valid session |
| `403` | authenticated but role/policy forbids the action |
| `404` | resource absent, soft-deleted, or outside the caller's authorized workspace; prevents enumeration |
| `406` | unsupported `Accept`, including a stream route without stream acceptance |
| `409` | uniqueness/state conflict, idempotency mismatch/in progress, owner invariant, or duplicate operation |
| `412` | stale `If-Match` precondition |
| `413` | request body or upload declaration too large |
| `415` | unsupported JSON or file media type |
| `422` | structurally valid request with field validation failures |
| `428` | required `If-Match` or `Idempotency-Key` missing |
| `429` | rate/quota limit reached; includes `Retry-After` when time-based |
| `500` | unexpected internal failure with opaque request ID |
| `502` | AI/storage/extraction upstream failure before a stream begins |
| `503` | required dependency unavailable, readiness failure, or transient account provisioning; optional `Retry-After` |
| `504` | bounded upstream timeout before a stream begins |

Domain `code` examples include `invalid_cursor`, `email_unverified`, `account_provisioning`, `workspace_limit_reached`, `workspace_kind_forbidden`, `last_owner`, `ownership_resolution_required`, `stale_version`, `quota_exceeded`, `document_not_ready`, `upload_mismatch`, `restoration_unavailable`, `export_not_ready`, `generation_in_progress`, `generation_cancelled`, `workflow_invalid`, and `dependency_unavailable`. Codes are stable; prose may improve.

### 3.4 Validation and request limits

- Every body, path parameter, and query is parsed through a server-side schema. Validation happens before the service layer, and authorization is repeated in the service for defense in depth.
- Strings are Unicode-normalized where appropriate, trimmed where whitespace is not meaningful, and bounded. Titles are at most 200 characters; workspace/workflow/collection names are at most 120; chat questions/content are at most 32,000 Unicode characters and 64 KiB UTF-8; batch ID arrays contain at most 50 unique IDs.
- General JSON bodies are at most 256 KiB. A workflow definition may be at most 1 MiB. Route/proxy/platform limits must be configured consistently; the smallest limit wins.
- `null` means “clear this optional value” only when the field contract permits it. Omitted fields are unchanged on `PATCH`.
- URLs are parsed, scheme/host allowlisted where external URLs are permitted, and never fetched merely because validation succeeded.
- Rich text is stored as source Markdown/plain text and rendered with a sanitizer. HTML, scripts, event attributes, and unsafe URL schemes are never accepted as trusted content.

### 3.5 Optimistic concurrency

Mutable resources return an `ETag` such as `"workspace:018f...:3"`. Marked **E** mutations require the exact current value in `If-Match`; missing yields `428`, stale yields `412` with the current safe representation or ETag where authorized. A successful change increments `version` once. Collection actions that lock their own state (invitation acceptance, message finalization, cancellation) use state-machine conflicts rather than `If-Match`.

### 3.6 Idempotency

Marked **I** endpoints claim an `Idempotency-Key` scoped to actor, workspace, HTTP method, normalized target path, and route template:

1. The server hashes the canonical validated request and the key.
2. A completed matching request replays the original status and bounded JSON body with `Idempotency-Replayed: true`.
3. Reusing a key with different input returns `409 idempotency_mismatch`.
4. A concurrent matching request returns `409 idempotency_in_progress` plus a short `Retry-After`.
5. Normal keys live at least 24 hours. Workflow execution keys live through the documented execution retry window, and data-export keys live through the export job metadata window.

Never store raw keys or signed URLs in the replay row. For an upload-intent replay, return the same document resource but mint a fresh short-lived upload grant; this is the documented exception to byte-for-byte response replay. Stream bodies are not replayed: chat/question endpoints use the key plus `clientMessageId` to return the existing assistant/message IDs; the client fetches the persisted message when a completed operation is retried. A delayed data-export retry therefore resolves to the original job. `DELETE` is naturally idempotent: deleting an already-deleted resource returns `204` only if the caller can still prove the resource belonged to the authorized scope; otherwise `404`.

### 3.7 Pagination, filtering, and search

- Collections use cursor pagination: `?limit=20&cursor=opaque`. Default 20, maximum 100. Offset pagination is not exposed.
- Cursors encode the exact filter/sort and deterministic `(sortValue, id)` boundary, are authenticated against tampering, and expire after a bounded period. A cursor used with changed filters returns `400 invalid_cursor`.
- Default ordering is newest first (`createdAt DESC, id DESC`) unless the endpoint specifies message/log sequence order.
- Search uses `?query=` on the collection being searched and remains constrained by workspace authorization. v1 does not expose a cross-workspace global search.
- Common filters use named query parameters (`status`, `role`, `unread`, `from`, `to`, `type`, `model`). Unknown filters are rejected.
- A list can be eventually consistent with asynchronous processing, but cursor membership/order is always based on persisted database state.

## 4. Authentication, CSRF, authorization, and audit

### 4.1 Session and request security

- Resolve the session server-side through Better Auth for every protected route. A proxy/middleware redirect is a user-experience optimization, not the authorization boundary.
- Better Auth handles CSRF/origin protections for its catch-all route. NEXUS AI state-changing cookie-authenticated routes require JSON/non-simple requests and validate `Origin` against the configured canonical/trusted origins; use Fetch Metadata as an additional signal. CORS is same-origin by default and never combines wildcard origins with credentials.
- Session cookies are Secure in production, HttpOnly, appropriately SameSite, scoped narrowly, and managed by Better Auth. Do not copy the session token into local storage.
- Suspended or pending-deletion users are denied new product mutations; session revocation is initiated immediately. Particularly sensitive changes may require a fresh session using Better Auth's supported mechanism after version verification.
- A verified account receives one personal workspace idempotently after email verification and before first product access. If the pinned Better Auth verification hook can participate in the product database transaction, that transaction creates the workspace, Owner membership, quota/preference state, and provisioning completion together. Otherwise the hook records a durable provisioning state for an idempotent worker. Except for the Better Auth flow and `GET /api/v1/me`, protected product routes return `503 account_provisioning` with a bounded `Retry-After` until provisioning is `READY`; they never continue with a half-created tenant.

### 4.2 Workspace RBAC

All workspace routes first resolve membership by `(workspaceId, session.user.id)` and then load targets by both target ID and workspace ID.

| Capability | Owner | Admin | Member |
| --- | ---: | ---: | ---: |
| Read workspace/shared content | Yes | Yes | Yes |
| Create conversation/document/knowledge | Yes | Yes | Yes |
| Edit/delete own content | Yes | Yes | Yes |
| Edit/delete another member's content | Yes | Yes | No |
| Edit workspace metadata | Yes | Yes | No |
| Invite/remove `MEMBER` | Yes | Yes | No |
| Promote/demote `ADMIN` | Yes | No | No |
| Publish/edit any workflow | Yes | Yes | No |
| Run a published workflow | Yes | Yes | Yes |
| Export own data in this workspace | Yes | Yes | Yes |
| Export the whole workspace | Yes | No | No |
| Transfer ownership/delete workspace | Yes | No | No |

An admin cannot remove/demote the owner or another admin. The owner cannot remove themselves until ownership is transferred. v1 assumes workspace content is visible to all members; per-resource private ACLs require a later contract change.

### 4.3 Platform administration

`PlatformRole.ADMIN` is checked independently of membership. Platform admins use only `/api/v1/admin/**` for global operations. Ordinary workspace endpoints do not silently grant platform admins access to tenant content. Any future support access or impersonation requires an explicit reason, user-visible/audited event, bounded duration, and separate design.

Every membership/role change, account suspension/deletion, workspace deletion, workflow publication/execution control, quota override, platform setting change, and administrator read of sensitive metadata writes an audit event. Audit writes contain allowlisted changes, not raw prompts, document text, credentials, signed URLs, or provider errors.

## 5. Rate limits and quotas

The initial controls in [Security Requirements section 8](./SECURITY_REQUIREMENTS.md#8-abuse-prevention-and-rate-limiting) are normative and are reproduced here so route implementations have one concrete contract. Any tuning must update both documents; loosening a high-risk limit requires the recorded review required there. Enforcement uses layered WAF controls, distributed application counters, and durable quotas/concurrency checks. Application keys combine the appropriate verified user, normalized account identifier, workspace, and trusted client IP; an in-process counter is not an enforcement boundary.

| Surface | Initial enforcement |
| --- | --- |
| Anonymous non-auth API | 60 requests/minute/trusted IP; health infrastructure may use a separate allowlist |
| Authenticated reads | 120 requests/minute/user; search 60/minute/user |
| Ordinary mutations | 60 requests/minute/user and 120/minute/workspace |
| Failed sign-in | 5/15 minutes/account plus 20/15 minutes/IP; exponential delay; no permanent attacker-triggered lockout |
| Registration | 5/hour/IP plus email-domain abuse monitoring |
| Verification/recovery/deletion email request | 3/hour/account and 10/hour/IP, with an enumeration-safe response |
| Token verification/reset consume | 5/15 minutes/token-purpose and IP |
| AI generation/document questions | 10 starts/minute/user, 30/hour/user, 2 concurrent/user, 4 concurrent/workspace, plus plan/day token and monetary ceilings |
| Upload intents/completions | 10 requests/minute/user, 10 finalized files/hour/user, 250 MiB/hour/workspace, and 2 concurrent processing jobs/user |
| Private download URL issuance | 60/minute/user |
| Workflow start | 10/minute/user and 2 concurrent/workspace; stricter limits for side-effecting nodes |
| Data-export request | 3/hour/user and 1 active export/user/workspace; also bounded by worker/storage quota |
| Platform administration | 120 reads/minute/admin; 30 mutations/minute/admin plus anomaly alerting; no bulk operation without a purpose-built limit |

A rejected request returns `429`, a stable code (`rate_limited`, `quota_exceeded`, or `concurrency_limit`), and `Retry-After` when meaningful. Responses may expose standardized rate-limit headers after the exact supported standard is selected; clients must rely on status/code rather than undocumented headers. AI, workflow, upload, export, auth-sensitive, and admin mutations fail closed if the required shared limiter/quota service cannot be reached. Limits are abuse controls, not authorization.

Provider quota is reserved in a short transaction before starting costly work and reconciled from actual usage on completion/failure. The response never claims exact provider cost when it is an estimate.

## 6. Direct document upload contract

Uploads never pass file bytes through a general JSON route handler.

1. `POST .../documents/upload-intents` validates declared name, MIME type, size, quota, and idempotency, creates an `UPLOADING` document, and returns a short-lived signed `PUT` target.
2. The response supplies the exact HTTP method and required headers. The browser must not add/change signed headers. The URL is sensitive, single-purpose, TLS-only, and expires in at most 5 minutes.
3. `POST .../documents/{documentId}/upload-completion` verifies the object with the storage service (key, size, checksum/version where supported), never trusts client completion alone, and queues extraction.
4. A worker streams the object, enforces the configured `DOCUMENT_MAX_BYTES` again, checks magic bytes/container structure, rejects encrypted/unsupported/malformed content, and extracts with resource/time/page limits. The provisional engineering/test baseline is 25 MiB per file and 500 pages, not a launch promise; the public config returns the actual effective byte and page limits. Only PDF, DOCX, and plain UTF-8 text are accepted initially.
5. The document remains unavailable for Q&A until `READY`. `QUARANTINED` and internal failure details are not downloadable. Failed/abandoned objects are lifecycle-cleaned.

Example intent request:

```json
{
  "filename": "research.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": "4829137",
  "sha256": "optional-base64url-digest"
}
```

Example response data:

```json
{
  "document": {
    "id": "018f...",
    "status": "UPLOADING",
    "version": 1
  },
  "upload": {
    "method": "PUT",
    "url": "https://storage.example/signed-value",
    "headers": {
      "Content-Type": "application/pdf"
    },
    "expiresAt": "2026-11-07T10:05:00.000Z"
  }
}
```

Signed download endpoints return a URL valid for at most 60 seconds only after authorization and use `Cache-Control: no-store`. The client-provided filename is sanitized for `Content-Disposition`; it never selects the storage key. Multipart upload is a future additive endpoint if the final maximum size needs it.

## 7. AI and document-answer streaming

Generation endpoints use a NEXUS-owned SSE protocol over `fetch` with a POST body. The service may consume Vercel AI SDK `streamText` internally, including its abort signal, but the external wire contract does not expose unstable provider chunks or require clients to depend on an undocumented SDK protocol.

### 7.1 Lifecycle

- Before headers are committed, validation/auth/quota/provider setup errors use normal Problem Details.
- The service transaction persists the user message and a `PENDING` assistant message. The response then starts with HTTP `200` and `Cache-Control: no-store, no-transform`, `Connection: keep-alive` where the platform permits, and proxy-buffering disabled where applicable.
- After streaming begins, failures are SSE events because the HTTP status cannot change.
- Text is accumulated server-side and checkpointed in bounded batches, not one database write per token. Completion atomically persists canonical content, status, usage, model snapshot, citations, and conversation leaf.
- `request.signal` is passed to the generation layer. A client disconnect requests cancellation. `POST .../generations/{assistantMessageId}/cancellation` supports a second UI control; cancellation is idempotent and best-effort until the provider confirms. Multi-instance cancellation requires shared Redis state/pub-sub or a worker architecture.
- A disconnected client reconciles with `GET .../messages/{assistantMessageId}`. Automatic SSE replay and `Last-Event-ID` resume are not supported in v1.
- A heartbeat comment or `heartbeat` event is emitted about every 15 seconds during upstream silence, subject to platform limits.

### 7.2 Event format

Each event has an increasing connection-local `id`, a named `event`, and one JSON `data` object:

```text
id: 1
event: generation.started
data: {"conversationId":"018f...","userMessageId":"018f...","assistantMessageId":"018f...","model":"provider/model-key"}

id: 2
event: message.delta
data: {"assistantMessageId":"018f...","delta":"Hello"}

id: 3
event: generation.completed
data: {"assistantMessageId":"018f...","status":"COMPLETED","finishReason":"stop","usage":{"inputTokens":"120","outputTokens":"42"}}
```

Allowed events:

| Event | Meaning |
| --- | --- |
| `generation.started` | Stable resource IDs exist; safe model key included. |
| `message.delta` | Ordered text delta; may be empty only when accompanied by metadata in a future additive field. |
| `citation` | Authorized citation metadata (`documentId`, `chunkId`, label/ordinal, bounded excerpt), never storage key. |
| `generation.usage` | Optional non-final cumulative estimate; final persisted usage wins. |
| `generation.completed` | Terminal success with finish reason and final usage. |
| `generation.cancelled` | Terminal cancellation; indicates whether partial content was retained. |
| `generation.error` | Terminal safe error `{code, message, retryable, requestId}` after stream start. |
| `heartbeat` | Keeps intermediaries/client watchdogs alive; no product state. |

Only one terminal event is emitted. Chain-of-thought/reasoning tokens, hidden system prompts, provider credentials, raw tool payloads, and unfiltered provider errors are never streamed. The service treats document text as untrusted context and keeps it in a clearly delimited, lower-priority prompt section.

## 8. Endpoint inventory

Legend: **I** requires `Idempotency-Key`; **E** requires `If-Match`; `W` is `/api/v1/workspaces/{workspaceId}`. In workspace endpoint authorization cells, `Admin` means `ADMIN` or the inheriting `OWNER`; `Creator/Admin` means the creator or an Admin/Owner; `Requester/Admin` follows the same inheritance. Every `W` route requires membership and validates every child against the same workspace. A collection that is the only read surface for an **E** target returns that item's `version` and strong `etag`; this explicitly includes member, invitation, knowledge-collection, knowledge-tag, notification, and platform-setting rows.

Restoration routes are the sole exception to the normal rule that a soft-deleted target behaves as `404`. They authorize against retained workspace membership and the resource's documented Creator/Admin/Owner policy, lock the tombstone, and restore only while `purgeStartedAt` is null and the recovery deadline has not elapsed. They are **I** operations: an already-active authorized target returns its current `200` representation, while an expired/claimed purge or an unsatisfied uniqueness/dependency invariant returns `409 restoration_unavailable`. A deleted workspace must be restored before any child can be restored.

### 8.1 Public and operational

| Method and path | Auth | Contract |
| --- | --- | --- |
| `GET /api/v1/health/live` | Public | Process liveness only; `200 {data:{status:"ok"}}`; no dependency or version details. |
| `GET /api/v1/health/ready` | Public/infrastructure-controlled | Bounded readiness for the database and only the dependencies required by currently enabled features; a disabled/optional provider cannot make the service unready. Returns `200` or `503` with no credentials, topology, SQL, or provider account data. |
| `GET /api/v1/health/dependencies` | Monitoring bearer only | Bounded PostgreSQL, Redis, private-storage, and scanner reachability; `200` or `503`, private/no-store, with status/duration only. Invalid or absent credentials receive `404`; no topology, account, bucket, URL, or exception details are returned. |
| `GET /api/v1/public/config` | Public | Safe UI capabilities: product name, supported upload MIME types, effective maximum bytes/pages, registration/pricing feature flags. Never secrets, internal model credentials, or admin flags. Short public cache allowed. |

Marketing content is statically rendered unless a later CMS requires its own reviewed API.

### 8.2 Authentication and account/profile/settings

| Method and path | Contract |
| --- | --- |
| `GET\|POST /api/auth/[...all]` | Better Auth-owned catch-all; not wrapped/versioned by NEXUS AI. |
| `GET /api/v1/me` | Current safe user/profile/account/provisioning-status representation and ETag; no account token/password fields. This is available while personal-workspace provisioning is pending. |
| `PATCH /api/v1/me` **E** | Update product profile fields not owned by a specialized Better Auth flow (for example display name/image only if configured compatibly). Email/password/security changes use Better Auth. Body is a partial allowlist. |
| `GET /api/v1/me/preferences` | Theme, locale/time zone, default workspace/model, AI and notification preferences, with version and ETag. |
| `PATCH /api/v1/me/preferences` **E** | Partial preference update; model key must be enabled and no secret/provider API key is accepted. |
| `POST /api/v1/me/deletion-request` **I** | Requires fresh auth, credential password re-entry, exact destructive confirmation, and first locks/checks owned workspaces. If any owned `TEAM` workspace is neither transferred nor already `PENDING_DELETION`, return `409 ownership_resolution_required` and make no account/session change. Otherwise start the grace workflow, revoke all sessions, queue the verified-email cancellation capability, and return `202`; the effective date is no earlier than both the approved account grace and the latest explicitly deleted team-workspace `purgeAfter`. |
| `GET /api/v1/me/deletion-request` | Return the active or latest deletion request status (`PENDING`, `CANCELLED`, `RUNNING`, `COMPLETED`, or `FAILED`), effective date, cancellation eligibility, and relevant scheduled workspace-deletion summaries; `404` when no request exists. |
| `POST /api/v1/account-deletion/cancellations` | Consume the digest-only, single-use verified-email capability during the grace period if purge has not started; restore the account and return `200`. The token is never logged or retained in plaintext. |

Session listing/revocation, password reset/change, email verification/change, login, logout, and registration are performed through the pinned Better Auth client contract. NEXUS AI pages may orchestrate those client calls but must not create parallel password/session endpoints.

### 8.3 Dashboard

| Method and path | Contract |
| --- | --- |
| `GET /api/v1/dashboard?workspaceId={id}` | Aggregated recent conversations/documents, workspace overview, quota/usage summary, quick-action capability flags, and safe recent activity. Membership is required when `workspaceId` is supplied; otherwise use the authorized default workspace. One bounded query contract, not unpaginated histories. |

### 8.4 Workspaces, invitations, and members

A `PERSONAL` workspace is private and permanently sole-owner. Member, invitation, and ownership-transfer routes in this section apply only to `TEAM`; they return `409 workspace_kind_forbidden` for `PERSONAL`. A personal workspace is deleted only through governed account deletion.

| Method and path | Authorization | Contract |
| --- | --- | --- |
| `GET /api/v1/workspaces` | User | Cursor list of memberships/workspace summaries, including `version`/`etag`; filters `role`, `query`. |
| `POST /api/v1/workspaces` **I** | User | `{name, slug?}`; creates a team workspace and sole owner membership atomically; `201`. The personal workspace is provisioned after email verification, not through this endpoint. |
| `POST W/selection` | Member | Re-authorize current membership, persist this workspace as the caller's active/default navigation preference, and return the workspace; `200`. The preference is never authorization proof. |
| `GET W` | Member | Workspace details plus caller capabilities and ETag. |
| `PATCH W` **E** | Admin | Partial `{name, slug?}`; `200`. |
| `DELETE W` **E** | Owner | Makes a team workspace inaccessible and schedules recoverable deletion; purge/object cleanup begins only after the approved grace period; `202`, not immediate success theater. The personal workspace is deleted only through governed account deletion. |
| `POST W/restoration` **I** | Owner | Restore a deleted team workspace during its recovery window using retained Owner membership; `200`. This special route may load the workspace tombstone. |
| `GET W/members` | Member | Cursor list whose items include `version`/`etag`; filters `role`, `query`. Email exposure follows workspace privacy policy. |
| `PATCH W/members/{memberUserId}` **E** | Owner | Change `MEMBER <-> ADMIN`; cannot target owner/self into invalid state. |
| `DELETE W/members/{memberUserId}` **E** | Self/Admin/Owner | In a `TEAM` workspace, a non-Owner may leave by targeting self; Admin may remove Members only; Owner may remove any non-Owner. `PERSONAL`, sole-Owner leave, and unauthorized targets are rejected without leaking cross-tenant existence. |
| `GET W/invitations` | Admin | Cursor list of pending/expired invitations with per-item `version`/`etag`; token never returned. |
| `POST W/invitations` **I** | Admin | `{email, role}`; an Admin may invite only `MEMBER`, while the Owner may invite `MEMBER` or `ADMIN`; sends mail through outbox; generic response prevents account enumeration. |
| `DELETE W/invitations/{invitationId}` **E** | Admin | Revoke invitation; `204`. |
| `POST /api/v1/workspace-invitations/accept` **I** | User | `{token}` in body, not URL/logs; validates session email/policy and atomically creates membership; `200`. |
| `POST W/ownership-transfers` **I** | Owner | `{newOwnerUserId}`; serializable owner/member transition; returns updated workspace and both membership roles. |

### 8.5 Conversations, messages, regeneration, and cancellation

| Method and path | Authorization | Contract |
| --- | --- | --- |
| `GET W/conversations` | Member | Cursor list; filters `query`, `status`, `createdByMe`; FTS remains tenant scoped. |
| `POST W/conversations` **I** | Member | `{title?, modelKey?, documentIds?}`; creates empty conversation; `201`. |
| `GET W/conversations/{conversationId}` | Member | Conversation, caller capabilities, attached document summaries, ETag; messages are separately paged. |
| `PATCH W/conversations/{conversationId}` **E** | Creator/Admin | Partial `{title, status, modelKey}`. Model change affects future messages only. |
| `DELETE W/conversations/{conversationId}` **E** | Creator/Admin | Soft delete; `204`. |
| `POST W/conversations/{conversationId}/restoration` **I** | Creator/Admin | Restore the conversation during its recovery window; `200`. |
| `GET W/conversations/{conversationId}/messages` | Member | Cursor list in deterministic branch/sequence order; `limit` max 100. |
| `GET W/conversations/{conversationId}/messages/{messageId}` | Member | Canonical persisted message/status/citations; useful after disconnect. |
| `POST W/conversations/{conversationId}/messages` **I**, SSE | Member | Body below; creates user+assistant rows and streams assistant events. |
| `POST W/conversations/{conversationId}/messages/{assistantMessageId}/regenerations` **I**, SSE | Member | `{clientGenerationId, modelKey?}`; target must be an assistant message; creates a sibling branch, never overwrites history. The client generation ID is unique within the conversation and binds retries to one assistant row. |
| `POST W/conversations/{conversationId}/generations/{assistantMessageId}/cancellation` **I** | Requester/Admin | Marks cancellation requested and signals active generation; `202`; repeated cancellation is safe. |

Message request:

```json
{
  "clientMessageId": "client-generated-uuid",
  "content": "Summarize the attached sources.",
  "modelKey": "openai/model-alias",
  "documentIds": ["018f..."],
  "parentMessageId": "018f..."
}
```

`modelKey` is an enabled server-side alias, never a client-supplied base URL or API key. `parentMessageId` is optional for the current active leaf but required when intentionally branching. All attached documents must be `READY` in the same workspace.

### 8.6 Documents, processing, download, and questions

| Method and path | Authorization | Contract |
| --- | --- | --- |
| `GET W/documents` | Member | Cursor list; filters `query`, `status`, `mimeType`, `createdByMe`. |
| `POST W/documents/upload-intents` **I** | Member | Declared metadata; creates `UPLOADING` document and returns signed PUT contract; `201`. |
| `POST W/documents/{documentId}/upload-completion` **I** | Creator/Admin | Verify private object and queue extraction; `202`. |
| `GET W/documents/{documentId}` | Member | Metadata, status, safe processing result, summary, page/chunk counts when ready, ETag. Never storage key. |
| `PATCH W/documents/{documentId}` **E** | Creator/Admin | Rename display name only; original filename remains provenance. |
| `DELETE W/documents/{documentId}` **E** | Creator/Admin | Makes the document inaccessible and schedules purge after the recovery window; `202`; fails `409` if a normalized workflow-version/execution dependency requires it. |
| `POST W/documents/{documentId}/restoration` **I** | Creator/Admin | Restore metadata, bytes/chunks, and the pre-deletion processing status during the recovery window; `200`. |
| `GET W/documents/{documentId}/processing-runs` | Member | Cursor processing history with safe codes/redacted errors. |
| `POST W/documents/{documentId}/reprocessing-jobs` **I** | Creator/Admin | Queue a new extraction run when not already active; `202`. |
| `POST W/documents/{documentId}/download-url` | Member | Signed GET URL with a maximum 60-second lifetime and explicit expiry; `200`, no-store; denied for quarantined/deleting rows. This is a read-like grant operation and is not idempotency-cached. |
| `POST W/documents/{documentId}/questions` **I**, SSE | Member | `{clientMessageId, question, conversationId?, modelKey?}`; document must be ready; creates/reuses a conversation, persists Q/A, and streams the same generation event protocol with citations. |

No endpoint exposes raw chunks in bulk. Authorized citations return only bounded excerpts needed to explain an answer. Summary generation is processing output visible on the document; a future explicit regeneration endpoint may be added when quota semantics are settled.

### 8.7 Knowledge collections, tags, items, and search

| Method and path | Authorization | Contract |
| --- | --- | --- |
| `GET W/knowledge-collections` | Member | Cursor/tree-friendly list with `parentId` filter and per-item `version`/`etag`. |
| `POST W/knowledge-collections` **I** | Member | `{name, description?, parentId?}`; `201`. |
| `PATCH W/knowledge-collections/{collectionId}` **E** | Creator/Admin | Rename/move; cycle checks required. |
| `DELETE W/knowledge-collections/{collectionId}` **E** | Creator/Admin | `409` until child collections and contained items are explicitly moved, unfiled, or deleted; then `204`. v1 does not silently unfile items, and collection deletion is not user-restorable. |
| `GET W/knowledge-tags` | Member | Cursor/tag-prefix list with per-item `version`/`etag`. |
| `POST W/knowledge-tags` **I** | Member | `{name}` normalized uniquely; returns existing tag for same normalized name. |
| `DELETE W/knowledge-tags/{tagId}` **E** | Admin | Deletes assignments and tag; `204`. |
| `GET W/knowledge-items` | Member | Cursor list/search; filters `query`, `collectionId`, `tagId`, `sourceType`, `createdByMe`. |
| `POST W/knowledge-items` **I** | Member | `{title, content, collectionId?, tagIds?, source?}`; source IDs must be authorized in same workspace; `201`. |
| `GET W/knowledge-items/{itemId}` | Member | Full item, provenance summary, tags, capabilities, ETag. |
| `PATCH W/knowledge-items/{itemId}` **E** | Creator/Admin | Partial content/organization/tag update. |
| `DELETE W/knowledge-items/{itemId}` **E** | Creator/Admin | Soft delete; `204`. |
| `POST W/knowledge-items/{itemId}/restoration` **I** | Creator/Admin | Restore the item during its recovery window after validating collection/provenance invariants; `200`. |

### 8.8 Workflows, versions, executions, and logs

| Method and path | Authorization | Contract |
| --- | --- | --- |
| `GET W/workflows` | Member | Cursor list; filters `query`, `status`, `createdByMe`. |
| `POST W/workflows` **I** | Admin | `{name, description?}`; creates draft shell; `201`. |
| `GET W/workflows/{workflowId}` | Member | Metadata, active version summary, capabilities, ETag. |
| `PATCH W/workflows/{workflowId}` **E** | Admin | Metadata plus `DRAFT -> ARCHIVED`, `ARCHIVED -> DRAFT`, or `ACTIVE -> ARCHIVED`. Only publication can enter `ACTIVE`; definitions are versioned. |
| `DELETE W/workflows/{workflowId}` **E** | Admin | Soft delete after running-execution check; `202` if cleanup needed. |
| `POST W/workflows/{workflowId}/restoration` **I** | Admin | Restore the workflow during its recovery window after validating its name and active-version dependencies; `200`. |
| `GET W/workflows/{workflowId}/versions` | Member | Cursor list of immutable version metadata. |
| `POST W/workflows/{workflowId}/versions` **I** | Admin | `{schemaVersion, definition}`; validates allowlisted graph and creates immutable version; `201`. |
| `GET W/workflows/{workflowId}/versions/{versionId}` | Member | Immutable validated definition; secret references remain opaque. |
| `POST W/workflows/{workflowId}/versions/{versionId}/publication` **I** | Admin | Set active version and workflow active atomically; `200`. |
| `GET W/workflows/{workflowId}/executions` | Member | Cursor execution history; members see workspace runs under current shared-content policy. |
| `POST W/workflows/{workflowId}/executions` **I** | Member | `{input}` only; atomically resolves the workflow's published active version, requires workflow status `ACTIVE`, reserves quota, and queues controlled execution; `202`. Clients cannot select a historical/draft version. |
| `GET W/workflow-executions/{executionId}` | Member | Status, bounded input/output summary, timestamps, safe error; no secrets. |
| `GET W/workflow-executions/{executionId}/logs` | Member | Cursor by increasing sequence; redacted structured logs. |
| `POST W/workflow-executions/{executionId}/cancellation` **I** | Requester/Admin | `202`; terminal runs return their current terminal representation. |

The definition schema allows only registered node kinds and bounded configuration. There is no arbitrary code, shell, SQL, filesystem path, unrestricted HTTP destination, or user-provided template execution. Each node resolves secrets server-side and has explicit input/output schemas, timeouts, retry policy, egress policy, and resource budget.

### 8.9 Usage and quota

| Method and path | Authorization | Contract |
| --- | --- | --- |
| `GET /api/v1/usage/summary?workspaceId=&from=&to=&groupBy=` | User/member | Caller usage or authorized workspace summary; `groupBy` allowlist (`day`, `model`, `operation`). Values identify estimates. |
| `GET /api/v1/usage/records?workspaceId=&...` | User/member | Cursor records. Members receive their own records; workspace admins/owner may receive workspace aggregates/records according to privacy policy. No prompt/document content. |
| `GET /api/v1/usage/quota?workspaceId=` | User/member | Limit snapshot, consumed/reserved/remaining, period and reset time; `null` for truly unlimited, never magic negative numbers. |
| `PATCH /api/v1/usage/quota?workspaceId=` **E** | Owner/Admin | Replace request/input/output/estimated-cost limits for the workspace UTC month. Body values are non-negative decimal strings or `null`; requires the current policy ETag and writes an audit event. A cost quota fails closed for a model without approved effective pricing. |

Usage record provenance is `PROVIDER_REPORTED`, `DEVELOPMENT_ESTIMATE`, or `UNAVAILABLE`. `UNAVAILABLE` means a real provider attempt reached a terminal state without usable provider token fields; the service does not turn absence into claimed zero usage. Pricing state is independently `PRICED` or `UNPRICED`. Estimated cost is returned only with its currency/version and is always labeled as an estimate, not an invoice. The application ships no default model prices.

### 8.10 Notifications

Stable v1 types are `NEW_ACTIVITY`, `DOCUMENT_PROCESSING`, `WORKFLOW_STATUS`, and `SYSTEM_ALERT`. System alerts cannot be disabled. An `actionUrl` is an allowlisted application-relative path and conveys no authorization.

| Method and path | Contract |
| --- | --- |
| `GET /api/v1/notifications?unread=&type=` | Cursor list for current user only; every item includes `version`/`etag`. |
| `PATCH /api/v1/notifications/{notificationId}` **E** | `{read: true\|false}` for current user only. |
| `POST /api/v1/notifications/read-receipts` **I** | `{notificationIds}` or `{allBefore}` with mutual exclusivity; bounded batch/atomic update; `200` count. |
| `DELETE /api/v1/notifications/{notificationId}` **E** | Remove from the user's history; `204`. |

### 8.11 Portable data exports

This is a Phase 0 contract for a later implementation milestone; it does not imply that handlers, workers, or an export UI exist yet. Every export is workspace-scoped. `MY_DATA` is the current user's portable data within one workspace; clients request it once per workspace rather than obtaining an unbounded cross-tenant account dump. `WORKSPACE` is an Owner-only export of the active workspace. Recoverable deleted content is omitted unless restored first.

| Method and path | Authorization | Contract |
| --- | --- | --- |
| `POST W/data-exports` **I** | Member for `MY_DATA`; Owner for `WORKSPACE` | `{scope:"MY_DATA"\|"WORKSPACE"}`; creates a durable async job and returns `202` with job ID/status, archive schema version, and status URL. One active job per user/workspace; no archive is built in the request. |
| `GET W/data-exports/{exportId}` | Requester for `MY_DATA`; Owner for `WORKSPACE` | Return `QUEUED`, `RUNNING`, `READY`, `FAILED`, or `EXPIRED`, safe failure code, snapshot cutoff, counts, and artifact expiry when ready. Never returns a storage key or signed URL. Authorization is re-evaluated on every poll. |
| `POST W/data-exports/{exportId}/download-url` | Same as status | For `READY` and unexpired jobs, mint a private signed GET URL valid for at most 60 seconds; `200`, private/no-store. `409 export_not_ready` for other non-expired states; expired jobs remain metadata-only. This read-like grant is not idempotency-cached. |

The v1 artifact is `application/zip` containing `manifest.json` with `archiveSchemaVersion`, scope, workspace ID, cutoff, checksums, and counts; versioned UTF-8 JSON/JSONL entity files; and authorized original document files under a manifest-mapped path. `MY_DATA` includes the requester's profile/preferences, membership, and resources/messages they authored in that workspace. `WORKSPACE` includes active workspace resources and safe membership metadata. Neither scope includes credentials, session/verification/invitation tokens, storage keys, internal prompts, platform-admin data, raw audit/usage internals, provider payloads, or another tenant's data. Artifacts remain in private object storage, expire no later than seven days after `READY`, and are deleted by an idempotent cleanup job. Ready-job metadata is retained for at most 30 days after artifact expiry; failed or otherwise terminal jobs without an artifact are retained for at most 30 days after reaching that state.

### 8.12 Administration

All production routes require `PlatformRole.ADMIN` plus verified MFA assurance. Mutations additionally require fresh authentication, strict rate limiting applies throughout, and an audit reason is required where indicated. Phase 12 cannot expose this namespace in production until MFA enrollment/recovery, bootstrap, break-glass, audit, and revocation tests pass.

| Method and path | Contract |
| --- | --- |
| `GET /api/v1/admin/dashboard` | Platform totals/trends, dependency status summaries, failed jobs, and safe recent audit events. No prompts/document text. |
| `GET /api/v1/admin/users` | Cursor list; filters `query`, `status`, `platformRole`, date range. Searching email is audited. |
| `GET /api/v1/admin/users/{userId}` | Safe account, membership counts, usage aggregates, status, and version; no password/token/session token. |
| `PATCH /api/v1/admin/users/{userId}` **E** | Change allowlisted `platformRole`/status with `{reason}`. Cannot remove/suspend the last active platform admin or modify self into an unrecoverable state. |
| `POST /api/v1/admin/users/{userId}/session-revocations` **I** | Revoke all or selected session IDs using Better Auth's supported server API; session tokens are never returned; `{reason}` required. |
| `POST /api/v1/admin/users/{userId}/deletion-requests` **I** | Start the same governed deletion workflow with reason/notification; never immediate hard delete. |
| `GET /api/v1/admin/usage/summary` | Platform aggregate with date/model/operation grouping. |
| `GET /api/v1/admin/usage/records` | Cursor operational usage records; no content; access audited. |
| `GET /api/v1/admin/audit-logs` | Cursor list filtered by actor, workspace, action, target, outcome, request ID, date. Audit-log export remains a later, separately authorized contract and is not included in portable data exports. |
| `GET /api/v1/admin/settings` | Safe platform settings plus per-setting version/`etag`; secrets represented only as configured/not-configured. |
| `PATCH /api/v1/admin/settings/{key}` **E** | Validate the key-specific schema and `{value, reason}`; update/audit atomically. Secrets cannot be written here. |

## 9. Core resource representations

Responses may add safe fields, but these minimum shapes are stable:

- **Workspace:** `id`, `kind` (`PERSONAL` or `TEAM`), `name`, `slug`, `ownerUserId`, caller `role`, `capabilities[]`, `version`, timestamps.
- **Conversation:** `id`, `workspaceId`, `title`, `status`, `modelKey`, `activeLeafMessageId`, `lastMessageAt`, `createdBy`, `version`, timestamps.
- **Message:** `id`, `conversationId`, `role`, `status`, `sequence` (string), `parentMessageId`, `supersedesMessageId`, `content`, safe `parts`, `model`, `finishReason`, citations, timestamps. Internal/system messages can be omitted or redacted from ordinary clients.
- **Document:** `id`, `workspaceId`, `name`, `originalFilename`, `mimeType`, `sizeBytes` (string), `status`, `summary`, `pageCount`, safe `failureCode`, processing timestamps, `createdBy`, `version`. Never `storageKey`.
- **Knowledge item:** `id`, `title`, `content`, collection/tags, provenance summary, creator, `version`, timestamps.
- **Workflow:** metadata plus `activeVersion`; **WorkflowVersion:** immutable `versionNumber`, `schemaVersion`, definition and digest; no resolved secrets.
- **Data export job:** `id`, `workspaceId`, `scope`, `status`, `archiveSchemaVersion`, cutoff/counts, safe failure code, artifact expiry, `version`, timestamps; never a storage key or persistent download URL.
- **Usage:** provider/model/operation/status, token fields as strings, `estimatedCostMicros` as string, currency, pricing version, timestamp; never request content. Stable v1 statuses are `SUCCEEDED`, `FAILED`, `CANCELLED`, and `TIMED_OUT`; pre-provider quota rejections are not fabricated as usage rows.
- **User:** `id`, display name/image, email only where the caller is entitled, verification/account status, `provisioningStatus` (null until email verification, then `PENDING`, `RUNNING`, `READY`, or `FAILED`), platform role only for self/admin contexts, `version`, timestamps.

Fields named `capabilities` are server-derived hints for UI control visibility. They never replace authorization when a mutation arrives.

## 10. Observability and failure behavior

- Every response and stream event carries a request ID; logs use it with route template, status, duration, actor ID, workspace ID, and safe error code. Raw bodies and cookies are excluded.
- Provider/storage/queue calls have explicit connect/overall/idle timeouts and bounded retries with jitter only for retry-safe operations. An idempotency key does not make an arbitrary provider operation safe unless its adapter supports reconciliation.
- Readiness always tests the database and tests Redis, object storage, queueing, mail, or provider configuration only when that dependency is required by an enabled feature. Disabled and optional integrations do not affect readiness, and the check never makes a billable AI request.
- Database commit is authoritative. External mail, Redis jobs, extraction, and object deletion are delivered via the transactional outbox and idempotent consumers.
- If generation finishes at the provider but persistence fails, mark the assistant message failed/reconcilable, retain the provider/request IDs in restricted logs/usage, and never fabricate a completed response.
- Metrics include latency/error/rate-limit by route template, active streams, time to first token, provider usage/cost estimates, upload/extraction failures, queue lag, and idempotency replays. Labels never contain raw user IDs, emails, document names, prompts, or unbounded IDs.

## 11. Testing obligations derived from this contract

- Authentication: missing/expired/revoked/suspended sessions; Better Auth origin/verification/recovery flows.
- Authorization: horizontal ID swaps for every workspace/nested resource, all role boundaries, deleted resources, platform-admin separation, signed URL authorization.
- Validation: unknown fields, malformed JSON/cursors, Unicode/length boundaries, oversized bodies, forbidden MIME/container content, workflow graph/resource limits.
- Concurrency/idempotency: duplicate creates, hash mismatch, concurrent messages, owner transfer, quota reservation, stale ETags, repeated cancellation/completion.
- Streaming: pre-header problem response, ordered events and one terminal event, disconnect abort, provider timeout/error, partial persistence, cancellation from another instance, reconnection reconciliation.
- Data privacy: no secrets/storage keys/password/session tokens/raw provider errors in responses, logs, audit changes, notifications, or metrics.
- Pagination/search: no skipped/duplicated rows at equal timestamps; cursor filter binding; tenant filters on lexical/vector queries.
- Account/workspace/document deletion and restoration: grace deadlines, restore/purge claim races, invariant conflicts, outbox retries, object cleanup, and preserved/de-identified usage/audit evidence.
- Data export: scope/role isolation, stable manifest/schema, idempotent job creation, membership loss before polling/download, private object expiry, 60-second URL cap, and cleanup retries.

## 12. Unresolved contract decisions

1. Canonical production origin(s), trusted-origin policy, and whether non-browser/mobile or third-party API access is in scope.
2. Exact Better Auth version, enabled providers/plugins, required fresh-session mechanism, email delivery, and auth rate-limit integration.
3. Managed Vercel/serverless duration and streaming constraints; multi-instance cancellation architecture.
4. AI provider/model aliases, maximum context/output, per-model quotas, fallback policy, and whether provider fallback requires user consent.
5. Final launch upload size/page limits (25 MiB/500 pages is only the engineering/test baseline), checksum mechanism, malware scanner, multipart need, and storage vendor's signed-header behavior.
6. Workspace privacy: v1 assumes content shared to all members; private resources or team-level subspaces need new ACL resources.
7. Invitation rules for existing/different email identities. The first-release authority baseline is fixed: only the Owner may invite, promote, demote, or remove an Admin; any later delegation requires a contract and threat-model revision.
8. Workflow node schema, egress allowlist, human approval nodes, secret manager, retries/compensation, and maximum execution duration.
9. Billing plan, exact quota reservation/refund semantics, currency, pricing source/version, and who may see workspace member usage.
10. Legal approval for retention and legal-hold behavior, plus any future field-level expansion of the fixed `nexus-export-v1` portable archive schema.
11. Public pricing/config source and whether a CMS is needed.

## 13. Official references

- [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js Route Handler streaming](https://nextjs.org/docs/app/api-reference/file-conventions/route#streaming)
- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)
- [Better Auth security and CSRF protections](https://better-auth.com/docs/reference/security)
- [Better Auth session management](https://better-auth.com/docs/concepts/session-management)
- [Vercel AI SDK `streamText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AWS S3 presigned URL security model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
