# Product modules

Implemented vertical slices:

- `auth/` owns the Better Auth configuration, session data-access layer, server actions, typed browser client, and auth/profile UI.
- `workspaces/` owns personal-workspace provisioning, active-workspace selection, the fixed role policy, team-workspace lifecycle, invitations, membership/ownership transactions, validation, and responsive management UI.
- `chat/` owns model aliases, provider adapters, message branches, generation orchestration, and stream finalization.
- `documents/` owns private upload, extraction, indexing, authorized retrieval, and document-facing UI.
- `usage/` owns price snapshots, quota reservation/settlement, aggregate and record visibility, validation, and the usage UI.
- `notifications/` owns recipient-private durable notification creation, validation, pagination, read state, and HTTP support.
- `settings/` owns persistent AI/notification preferences plus governed account-deletion request, cancellation, and purge services.
- `workflows/` owns allow-listed graph validation, immutable versions, publication, execution orchestration, redacted logs, workflow UI, and usage-linked terminal state.
- `administration/` owns the independent platform-role/MFA authorization boundary, safe global read models, audited access mutations, allowlisted settings, rate limits, and console UI.

Knowledge and billing modules remain unimplemented. New modules must follow the boundaries and dependency direction in `docs/SYSTEM_ARCHITECTURE.md`; HTTP routes call module facades rather than reaching directly into another module's persistence or provider adapters.
