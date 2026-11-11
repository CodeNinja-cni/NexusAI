# Worker entry points

The bounded `scripts/dispatch-outbox.ts` scheduler handles authentication email, provisioning retries, and durable document/workflow queue publication. Long-lived BullMQ entry points are implemented at `scripts/document-worker.ts` and `scripts/workflow-worker.ts`; deploy them separately from request-scoped Next.js functions and scale them with bounded concurrency.

The document worker owns untrusted parsing and indexing. The workflow worker owns controlled interpretation of immutable, allow-listed graph definitions. Neither worker accepts a caller-selected module or command, and Redis payloads contain only opaque resource IDs.
