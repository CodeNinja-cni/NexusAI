# Phase 8 implementation: document intelligence

## Delivered scope

Phase 8 adds workspace-private PDF, DOCX, and TXT ingestion, asynchronous processing, PostgreSQL full-text retrieval, extractive summaries, and streaming document-grounded questions. It does not add embeddings or pgvector; the retrieval port deliberately keeps that migration additive.

## Lifecycle

1. The authenticated member submits filename, declared media type, byte size, and SHA-256 to `POST /api/v1/workspaces/{workspaceId}/documents/upload-intents` with a UUID v4 `Idempotency-Key`.
2. The service validates extension/type/size, authorizes workspace membership, locks quota accounting, reserves bytes/document count, creates an `UPLOADING` record, and returns a five-minute signed PUT grant.
3. The browser uploads directly to private storage and reports native XHR byte progress. The web process never proxies production file bodies.
4. Upload completion reauthorizes creator/Admin authority, performs a private `HEAD`, checks exact content type and size, verifies the declared hash contract, settles reserved quota, creates a versioned processing run, and inserts the queue request in the transactional outbox.
5. A best-effort fast publish sends the idempotent run ID to BullMQ. Failed publishing leaves the outbox `PENDING`; `npm run outbox:dispatch` safely retries it. Test mode schedules the same worker contract asynchronously without Redis.
6. The worker claims the run under an advisory lock, privately reads the bounded object, verifies SHA-256, scans it, validates its real format, extracts text, chunks it, and commits chunks/summary/run/document state atomically.
7. The detail UI polls persisted state while it is `QUEUED` or `PROCESSING`. It never infers completion from a browser timer.

## Security controls

- Object keys are generated server-side and are never exposed by document APIs.
- The S3/MinIO bucket is private. Upload and download grants are short-lived and operation-specific.
- Every metadata, download, search, retrieval, and question operation reauthorizes workspace membership near the database query. Cross-workspace resources return the same `404` as absent records.
- Upload intent and completion are separate. A signed upload alone cannot make a document searchable.
- The default size ceiling is 25 MiB and PDF extraction stops above 500 pages.
- Production/preview/staging reject filesystem storage, direct queues, structural-only scanning, and missing S3/Redis/ClamAV configuration.
- ClamAV uses the streaming `INSTREAM` protocol. Detected malware and declared/actual type mismatches enter `QUARANTINED` without chunks.
- TXT requires strict UTF-8. DOCX requires the Office container markers and rejects more than 2,000 archive entries or 50 MiB declared uncompressed content. PDF parsing disables system fonts and never executes application code.
- Safe failure codes reach clients; parser, scanner, storage, and provider details do not.
- Citations persist bounded excerpts and content hashes so historical answers retain evidence context when active processing versions change.

Structural scanning is intentionally a local/test convenience, not an antivirus substitute.

## Extraction and indexing

| Format | Validation | Extractor | Page metadata |
| --- | --- | --- | --- |
| PDF | Magic bytes plus PDF.js parser and page limit | PDF.js text content | Exact source page numbers |
| DOCX | Detected Office type, required ZIP entries, archive bounds | Mammoth raw text | Not available from DOCX layout |
| TXT | No conflicting binary signature; fatal UTF-8 decode | Platform `TextDecoder` | Not applicable |

Normalized text is split at whitespace/newline boundaries into 1,600-character chunks with 200-character overlap by default. Each immutable chunk stores ordinal, character/page bounds, a SHA-256 content snapshot, and an approximate token count. PostgreSQL stores a generated `simple`-configuration `tsvector` and a GIN index.

`DocumentRetriever` is the stable retrieval boundary. `PostgresFullTextDocumentRetriever` ranks matching active-run chunks with `ts_rank_cd`, then falls back to leading chunks when a well-formed query has no lexical hit. A future pgvector adapter can implement the same input/output contract without changing chat routes, citation persistence, or UI event shapes.

## Grounded questions

`POST /api/v1/workspaces/{workspaceId}/documents/{documentId}/questions` uses the normal provider availability check, PostgreSQL user/workspace rate limiter, conversation/message persistence, cancellation-capable SSE generator, and usage accounting.

Before generation, the service:

- verifies the selected document is `READY` in the caller's workspace;
- retrieves at most eight active-version chunks;
- attaches the document to the persisted conversation;
- creates citation rows for the pending assistant message;
- builds a bounded source packet that instructs the provider to answer only from supplied evidence and to admit missing evidence.

`generation.started` includes citation metadata before text deltas. A refresh obtains the same citations from persisted message history.

The mock provider remains explicit in local/test and is never used as a fallback when OpenAI is unavailable.

## HTTP surface

| Endpoint | Purpose |
| --- | --- |
| `GET .../documents` | Membership-scoped list/filter/search with keyset cursor support |
| `POST .../documents/upload-intents` | Reserve quota and issue a signed direct-upload grant |
| `GET\|PATCH\|DELETE .../documents/{id}` | Detail/status, creator/Admin rename, or soft-delete scheduling |
| `POST .../documents/{id}/upload-completion` | Verify the private object and queue processing |
| `POST .../documents/{id}/download-url` | Issue a 60-second authorized private download grant |
| `POST .../documents/{id}/questions` | Stream a persisted, source-grounded answer |

All product responses are private/no-store. Mutations use same-origin enforcement, strict Zod bodies, bounded JSON, safe problem responses, and ETags where the current route mutates a versioned record.

## Operations

The web server and worker are separate processes:

```bash
docker compose up -d --wait postgres redis garage mailpit
npm run storage:init
npm run db:deploy
npm run dev
npm run worker:documents
```

Garage creates `nexus-private` with the existing local S3 credentials. `storage:init` applies `docker/minio/cors.json`, verifies a signed object round trip, and rejects anonymous bucket access. The legacy `nexus-minio-data` volume is retained but is not mounted because Garage and MinIO use incompatible internal data formats.

Run `npm run outbox:dispatch` on a recurring bounded schedule. BullMQ jobs use the processing-run UUID as `jobId`, five exponential-backoff attempts, bounded completed/failed retention, and idempotent worker state checks. Redis must use a non-evicting policy; Compose configures `noeviction`.

## Verification

The automated suite covers:

- strict UTF-8 TXT extraction and chunking;
- valid DOCX container extraction;
- valid PDF text extraction with page locators;
- binary/type mismatch and invalid UTF-8 rejection;
- clean-database Phase 8 migration;
- signed upload and download grants;
- asynchronous TXT processing, summaries, chunks, and FTS search;
- streaming document Q&A and persisted citations;
- anonymous and cross-workspace denial;
- oversize upload declarations;
- malformed PDF quarantine with no chunks;
- responsive mobile document detail without horizontal overflow.

Run the focused journey with:

```bash
npm run db:test:with -- npm run test:integration:database -- tests/e2e/documents.spec.ts
```

## Primary implementation references

- [AWS SDK for JavaScript v3 S3 presigned URL examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html)
- [BullMQ worker and retry documentation](https://docs.bullmq.io/guide/workers)
- [BullMQ idempotent jobs guidance](https://docs.bullmq.io/patterns/idempotent-jobs)
- [PDF.js API](https://mozilla.github.io/pdf.js/api/)
- [Mammoth raw-text extraction](https://github.com/mwilliamson/mammoth.js)
- [PostgreSQL text-search indexes](https://www.postgresql.org/docs/current/textsearch-indexes.html)
