# Phase 11 — Controlled workflow engine

## Outcome

Phase 11 adds a workspace-scoped, versioned workflow engine without adding a general-purpose execution surface. Owners and Admins can author and publish. Members can inspect and execute the published version. PostgreSQL is authoritative for definitions, executions, limits, logs, usage links, audit events, cancellation, and recovery state; Redis/BullMQ transports only opaque job identifiers.

The implementation deliberately supports four nodes:

| Node | Input | Output | Behavior |
| --- | --- | --- | --- |
| `INPUT` | Execution `{text}` | Text | Introduces the validated run input. Exactly one is required. |
| `TEMPLATE` | Previous text | Text | Performs literal `{{input}}` and `{{previous}}` replacement. It never evaluates expressions. |
| `AI_PROMPT` | Previous text | Text | Calls one approved provider/model alias through the existing server-only provider port. No tools are exposed. |
| `OUTPUT` | Previous text | Text | Produces the bounded execution result. Exactly one is required. |

There is no code, shell, SQL, URL fetch, webhook, dynamic import, package, filesystem, template-expression, or unrestricted network node. Unknown kinds and configuration fields fail strict validation.

## User experience

- `/workflows` lists actual workspace records, filters by lifecycle, and lets an Owner/Admin create a draft shell.
- `/workflows/[workflowId]` provides a responsive visual canvas, SVG connections, node selection, keyboard-accessible position controls, typed connection editing, node configuration, immutable save, publication, execution, cancellation, history, output, safe errors, and redacted logs.
- Loading, empty, validation, runtime-error, and terminal execution states are explicit.
- Members receive a read/run surface without authoring controls; this is only a convenience because the API independently enforces the policy.

## Persistence and invariants

Migration `20261110120000_phase_11_workflow_engine` adds:

- `Workflow`: mutable metadata, lifecycle, active-version pointer, optimistic version, and recoverable-deletion fields;
- `WorkflowVersion`: immutable graph JSON, monotonic version number, schema version, SHA-256 digest, and publication timestamp;
- `WorkflowExecution`: bound workspace/workflow/version/requester, input digest, limit snapshot, queue identifier, state, bounded input/output, cancellation, and timestamps;
- `WorkflowExecutionLog`: increasing per-execution sequence, optional node ID, severity, allow-listed event/message/data, and retention timestamp;
- a `UsageRecord.workflowExecutionId` foreign key and index.

Tenant-owned parent/child relations use composite `(id, workspace_id)` keys. Execution-to-version uses `(workflow_version_id, workflow_id, workspace_id)`, so an execution cannot bind a version from another workflow or workspace. A deferred database trigger verifies that `Workflow.activeVersionId` belongs to the same workflow/workspace. A live, case-insensitive workflow name is unique within a workspace.

Definitions are never updated. Editing saves a new version. Publication revalidates the stored graph and enabled model aliases, marks the version published once, and atomically updates the active pointer/status. Execution requests never accept a version ID; the transaction locks/resolves the current active version.

## Graph validation

`src/modules/workflows/server/definition.ts` is the only definition parser. It uses strict discriminated schemas and whole-graph validation:

- exact schema version `nexus.workflow.v1`;
- bounded node/edge/AI-node counts and identifiers;
- exactly one input and output;
- unique node/edge IDs and source/target pairs;
- existing endpoints, no self-connections, valid terminal direction, and bounded fan-out;
- exactly one predecessor for every non-input node in this initial deterministic release;
- cycle rejection through topological sorting;
- reachability from the input;
- bounded positions and configuration strings;
- rejection of executable template markers such as `${...}` and `<%...`;
- canonical stable JSON hashing for version diagnostics and integrity.

The worker reparses the persisted immutable definition instead of trusting validation performed by the web process.

## Execution lifecycle

```text
QUEUED -> RUNNING -> SUCCEEDED
                  -> FAILED
                  -> TIMED_OUT
                  -> CANCEL_REQUESTED -> CANCELLED
QUEUED -> CANCELLED
```

Start is one serializable transaction that:

1. acquires a workspace advisory lock;
2. reauthorizes active membership and workspace state;
3. resolves an `ACTIVE` workflow and its active immutable version;
4. enforces 10 starts/minute/user and the configured workspace concurrency ceiling;
5. validates the graph again;
6. reserves quota for each AI node with a deterministic per-execution/node logical operation ID;
7. creates the execution, initial log, outbox event, and audit record.

The API then attempts queue publication. Failure does not lose work because the outbox remains pending. `scripts/dispatch-outbox.ts` retries publication. Direct execution exists only as a non-blocking test adapter and is rejected outside tests.

The worker acquires an execution advisory lock and compare-and-sets `QUEUED -> RUNNING`. It reloads current workspace, workflow, version, and requester membership. Membership loss, workspace deletion, cancellation, or a tombstone prevents new node work. Execution uses a fixed `switch` over the four node kinds; the definition cannot select a function or module. Every bounded outbox pass also sweeps wall-time-expired `RUNNING`/`CANCEL_REQUESTED` rows under the same execution lock, releases unused reservations, and records a durable timeout log/audit/notification without replaying AI work.

Cancellation is durable and idempotent. A queued run becomes `CANCELLED` and releases unused quota reservations. A running run becomes `CANCEL_REQUESTED`; database polling propagates an abort signal to the provider and prevents subsequent steps. The overall wall timer uses the same abort path.

## Limits

| Setting | Default | Accepted range / role |
| --- | ---: | --- |
| `WORKFLOW_MAX_NODES` | 40 | 2–100, publication and worker revalidation |
| `WORKFLOW_MAX_STEPS` | 100 | 2–100, snapshotted on execution |
| `WORKFLOW_TIMEOUT_MS` | 600,000 | 5,000–600,000, snapshotted wall deadline |
| `WORKFLOW_MAX_INPUT_CHARACTERS` | 16,000 | 100–64,000, validated before persistence |
| `WORKFLOW_MAX_OUTPUT_CHARACTERS` | 32,000 | 100–1,000,000, enforced after every node |
| `WORKFLOW_CONCURRENT_PER_WORKSPACE` | 2 | 1–20, enforced under a workspace lock |
| Workflow starts | 10/minute/user | PostgreSQL count in the start transaction |
| AI nodes | 4/version | Fixed validation ceiling |

Database check constraints independently bound definition, input, output, log data, step, timeout, and character-limit snapshots.

## AI, usage, and provider failure

AI nodes reuse the Phase 6 provider abstraction. OpenAI remains server-only and the local/test mock remains visibly labelled and unavailable in deployed environments. The node sends its fixed bounded instruction and wraps the predecessor value as untrusted data. It exposes no tools, retrieval, or side-effect API.

Every AI node has a deterministic logical operation ID derived from the execution and node IDs. Capacity is reserved before queueing. After a real provider attempt, one immutable usage record is linked to the workflow execution and settled using provider-returned usage. Mock counts remain `DEVELOPMENT_ESTIMATE`; missing provider counts remain `UNAVAILABLE`; approved effective pricing is snapshotted when present. No price or token value is invented.

A missing provider configuration releases the reservation and fails honestly. It never switches to the mock provider. Unstarted reservations are released on terminal finalization or queued cancellation.

## Authorization and privacy

| Action | Owner | Admin | Member |
| --- | --- | --- | --- |
| List/read workflow, versions, executions, logs | Yes | Yes | Yes |
| Create/edit/archive/delete/restore | Yes | Yes | No |
| Save/publish version | Yes | Yes | No |
| Execute active published version | Yes | Yes | Yes |
| Cancel own execution | Yes | Yes | Yes |
| Cancel another member's execution | Yes | Yes | No |

Every route authenticates a verified, provisioned principal; reauthorizes workspace membership near the query; validates route IDs and strict request bodies; and uses same-origin mutation checks. Unauthorized and nonexistent tenant objects share `404`. Workflow metadata updates/deletion use strong ETags. Execution starts require a scoped, hashed idempotency key; reuse with a different workflow/input/requester returns `409`.

Logs never contain workflow input/output, prompts, model responses, raw provider errors, credentials, cookies, URLs, or secrets. They record only state, node kind/ID, sequence, timing, character counts, version IDs, configured limits, and safe error codes. Full output remains in the authorized execution record.

## HTTP surface

- `GET|POST /api/v1/workspaces/{workspaceId}/workflows`
- `GET|PATCH|DELETE /api/v1/workspaces/{workspaceId}/workflows/{workflowId}`
- `POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/restoration`
- `GET|POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/versions`
- `GET /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/versions/{versionId}`
- `POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/versions/{versionId}/publication`
- `GET|POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/executions`
- `GET /api/v1/workspaces/{workspaceId}/workflow-executions/{executionId}`
- `GET /api/v1/workspaces/{workspaceId}/workflow-executions/{executionId}/logs`
- `POST /api/v1/workspaces/{workspaceId}/workflow-executions/{executionId}/cancellation`

All product responses are `private, no-store`. Collection APIs use bounded keyset/sequence pagination.

## Deployment

Run the Next.js web application, bounded outbox pass, and worker independently:

```bash
npm run outbox:dispatch
npm run worker:workflows
```

The worker requires `QUEUE_DRIVER=bullmq`. Redis must be private, authenticated, environment-separated, and preferably TLS-protected. Queue payloads contain only workspace/workflow/execution IDs. Worker processes require database, Redis, and AI-provider access but no object-store or shell capability for the initial node set. Platform resource limits and restricted egress remain required defense in depth.

## Verification

Unit coverage proves stable hashing/topological order and rejects unknown code/network/shell/SQL kinds, unknown configuration, expression syntax, cycles/invalid connections, and graph limits. PostgreSQL-backed browser/API coverage proves:

- unauthenticated denial and cross-workspace isolation;
- Member authoring denial and Owner publication;
- malicious code-node rejection;
- immutable version digest/publication;
- Member execution of the active version;
- idempotent replay without duplicate execution;
- actual mock-provider usage linked to the execution;
- durable terminal state, output, logs, and audit records;
- input content absent from logs;
- queued/running cancellation behavior;
- stale ETag rejection;
- responsive mobile workflow studio without page overflow.

Run all gates with `npm run check` and the database-backed suite with `npm run test:integration`.

## Deliberate boundaries and remaining hardening

- Loops, branching merges, document retrieval, approvals, external tools, webhooks, schedules, secrets, and side-effecting nodes are not implemented.
- A future network node requires the approved centralized egress broker and SSRF controls; a general fetch node remains prohibited.
- The worker prevents duplicate concurrent processing, uses one queue attempt because AI is not safely replayable, and the bounded scheduler terminalizes executions whose snapshotted wall deadline passed. Before broad production launch, add worker heartbeat/ownership metadata so operations can distinguish an abandoned worker from a provider call that may have completed just before the process died.
- Add a dedicated concurrent restore-versus-purge integration stress test when the workflow purge worker is implemented. Restoration already locks the tombstone and refuses rows whose purge was claimed.
- Per-workspace execution concurrency is reserved at start under a PostgreSQL lock. Queue-level fairness and global worker saturation policies still need production load tuning.
