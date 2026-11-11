# NEXUS AI Product Specification

**Status:** Phase 0 baseline · **Product owner:** Code Ninja · **Last reviewed:** 2026-11-07

**Tagline:** One workspace. Many possibilities.

## 1. Purpose

NEXUS AI is a production-minded AI productivity workspace for individuals who need to converse with AI, work with private documents, retain useful knowledge, and automate repeatable AI-assisted work in one coherent product. It is not a general-purpose chatbot wrapper: conversations, documents, knowledge, usage, and workflows are durable resources governed by a workspace and a consistent authorization model.

The first release serves individual users while using a workspace data model from the beginning. This avoids a later ownership migration and creates a controlled path to small-team collaboration.

## 2. Repository context

The repository assessment on 2026-11-07 found a greenfield Git repository:

- no application source, package manifest, lockfile, database schema, tests, CI, or deployment configuration;
- no commits and no configured remote;
- an initial local branch named `master`;
- no existing functionality or configuration to preserve.

All product behavior in this document is therefore proposed, not implemented. Phase 0 creates documentation only. Phase 1 must not be treated as approved until the product owner explicitly approves it.

## 3. Product outcomes

NEXUS AI should let a user:

1. create an account and enter a private personal workspace safely;
2. hold streaming AI conversations that remain searchable and reusable;
3. upload supported documents, understand their processing state, and ask grounded questions about them;
4. organize durable knowledge independently of chat history;
5. assemble constrained, auditable AI workflows without arbitrary code execution;
6. understand consumption, quotas, and model cost estimates;
7. manage security, privacy, notifications, and account lifecycle from one place.

### 3.1 Product principles

- **Workspace-first ownership:** every tenant content resource and active product operation belongs to a workspace, including resources in a user's default personal workspace. Identity, user-global preferences/security notifications, platform records, and approved de-identified retained evidence are explicit exceptions.
- **Trustworthy over magical:** distinguish saved, processing, failed, estimated, and completed states; never imply that an operation succeeded when it did not.
- **Grounded AI:** show which documents or knowledge items informed an answer and make uncertainty visible.
- **Safe by construction:** authorization is enforced server-side, private data stays private, and workflow capabilities are allow-listed.
- **Progressive complexity:** an individual can start quickly; team and automation features appear when useful.
- **Portable information:** provide export and deletion paths rather than trapping user content.

## 4. Target users and primary jobs

| Persona | Primary jobs | Typical sensitive data | Initial priority |
|---|---|---|---|
| Student | Explain readings, compare notes, draft study plans, retain findings | Coursework and personal notes | High |
| Developer | Investigate code/documentation, retain technical decisions, automate structured prompts | Proprietary code and credentials accidentally pasted | High |
| Researcher | Analyze source material, retrieve evidence, synthesize findings | Unpublished research and participant data | High |
| Content creator | Ideate, draft, reuse brand knowledge, create repeatable content workflows | Client briefs and unpublished work | Medium |
| Professional | Summarize documents, prepare decisions, organize recurring work | Business and personal information | High |
| Small team | Share governed context and workflows with role-based access | Company-confidential information | Foundation membership/RBAC; advanced collaboration later |

The primary job-to-be-done is: **When my work spans AI conversations, reference material, and repeatable processes, help me keep the context organized and reusable so I can move from question to reliable output without losing control of my data.**

Individuals are the launch audience. Basic multi-member workspace membership, invitations, and RBAC are foundation scope because the ownership model must be sound from the start; advanced collaboration and enterprise capabilities remain later-release work.

## 5. Scope and release boundaries

### 5.1 Foundation release

The first usable release should contain:

- registration, sign-in/out, email verification, password recovery, session management, profile editing, and account deletion;
- automatic creation of a default personal workspace;
- protected application shell and responsive design system;
- workspace creation, switching, editing, membership, and Owner/Admin/Member permissions;
- streaming text chat with conversation and message persistence, rename, search, regeneration, cancellation, and model choice;
- usage recording and user-visible limits for all AI calls;
- PDF, DOCX, and TXT upload to private storage, safe extraction, chunking, indexing, summarization, and grounded question answering;
- knowledge items associated with a workspace and searchable through PostgreSQL;
- in-app notifications and profile/security/AI settings;
- a constrained workflow engine with a defined node catalog, validation, execution history, and logs;
- an administration area for authorized platform operators, audit logs, usage, and platform settings.

Delivery is deliberately incremental. The release is not considered complete until the security and test gates in the roadmap pass.

### 5.2 Explicitly deferred unless separately approved

- billing, subscriptions, and payment processing;
- public sharing links and anonymous document access;
- real-time multi-user editing, comments, or presence;
- native mobile or desktop applications;
- unrestricted user code, shell commands, browser automation, or arbitrary outbound HTTP nodes;
- third-party plugin marketplace;
- enterprise SSO/SCIM, data residency controls, and customer-managed encryption keys;
- multimodal generation beyond what is explicitly designed and metered;
- semantic retrieval until PostgreSQL full-text retrieval has a measured quality baseline;
- provider fine-tuning or training on user data.

## 6. Information architecture

### 6.1 Public experience

- `/` — product value, primary use cases, and clear entry points.
- `/features` — capabilities organized around chat, documents, knowledge, and workflows.
- `/pricing` — truthful plan/availability information; no fabricated price or checkout behavior.
- `/about` — Code Ninja and product principles.
- `/login`, `/register`, `/forgot-password` — authentication entry points.

### 6.2 Authenticated experience

- `/dashboard` — welcome, recent work, usage snapshot, quick actions, and activity.
- `/workspace` and `/workspace/[id]` — workspace list/detail and membership administration.
- `/chat` and `/chat/[id]` — conversation list and focused chat.
- `/documents` and `/documents/[id]` — processing queue, document detail, summary, and grounded Q&A.
- `/knowledge` — searchable, organized knowledge items.
- `/workflows` and `/workflows/[id]` — workflow library, editor, execution controls, and logs.
- `/usage`, `/notifications` — consumption and in-app events.
- `/settings/profile`, `/settings/security`, `/settings/ai` — account and preference controls.

### 6.3 Administration experience

- `/admin`, `/admin/users`, `/admin/usage`, `/admin/audit-logs`, `/admin/settings`.

The application shell should keep workspace switching, primary navigation, search, notifications, and account controls predictable. Mobile behavior must preserve all essential operations without relying on hover.

## 7. Functional requirements

Requirement identifiers are stable references for design, implementation, and tests. A requirement remains planned until its milestone is accepted.

### 7.1 Identity and account

- **AUTH-001:** A visitor can register with email and password after accepting applicable terms.
- **AUTH-002:** Email ownership must be verified before sensitive or billable capabilities are enabled.
- **AUTH-003:** A user can sign in, sign out the current session, and revoke other sessions.
- **AUTH-004:** Password recovery uses a short-lived, single-use flow and does not disclose whether an email is registered.
- **AUTH-005:** Protected routes and APIs reject unauthenticated requests on the server.
- **AUTH-006:** A user can edit supported profile fields and AI preferences.
- **AUTH-007:** Account deletion requires recent re-authentication, explains its consequences, and rejects without changing account/session state until each owned team workspace is transferred or explicitly scheduled for recoverable deletion. It then creates an auditable deletion job whose effective date respects those recovery windows.
- **AUTH-008:** Authentication events that affect security are recorded without storing passwords, tokens, or raw secrets.

### 7.2 Dashboard

- **DASH-001:** The dashboard presents recent conversations and documents from the active workspace only.
- **DASH-002:** Workspace overview and usage values must come from persisted data, with clear empty/loading/error states.
- **DASH-003:** Quick actions create or navigate to real resources; unavailable actions are marked as unavailable rather than simulated.
- **DASH-004:** Activity displays security-appropriate audit or domain events and supports pagination.

### 7.3 Workspaces and authorization

- **WS-001:** After successful email verification and before first product access, every user receives one default personal workspace and sole Owner membership idempotently. Create them in the same transaction where the verified-registration hook supports it; otherwise use a durable provisioning state machine and block product access until it succeeds. A personal workspace stays private: it accepts no invitations or non-owner memberships; collaboration uses a team workspace.
- **WS-002:** A user can create, rename, and switch among workspaces to which they belong.
- **WS-003:** Membership roles are Owner, Admin, and Member; permissions are documented and enforced server-side.
- **WS-004:** Every workspace has exactly one Owner. In a team workspace, the Owner can transfer ownership, invite/remove Members or Admins, and change eligible roles. An Admin can invite/remove Members but cannot manage the Owner or another Admin. The Owner cannot leave or be demoted until ownership is transferred or the team workspace is deleted.
- **WS-005:** Destructive workspace operations require confirmation and a defined retention/deletion policy.
- **WS-006:** Resource lookup must include authorized workspace scope rather than fetching by globally unique ID and checking only in the client.

### 7.4 AI chat

- **CHAT-001:** A user can create a conversation in the active workspace and receive streamed assistant output.
- **CHAT-002:** User and completed assistant messages are persisted with ordering, model metadata, status, and usage linkage.
- **CHAT-003:** The UI distinguishes queued, streaming, completed, cancelled, and failed message states.
- **CHAT-004:** A user can stop generation; server processing and provider billing may continue until cancellation is acknowledged, which the UI must communicate honestly.
- **CHAT-005:** Regeneration creates a new assistant branch/attempt without destroying the prior response.
- **CHAT-006:** Conversation rename, search, archive/delete, and history retrieval are workspace-authorized.
- **CHAT-007:** Model choices are an application-controlled catalog with capability, availability, quota, and cost policies; clients cannot submit arbitrary provider model identifiers.
- **CHAT-008:** Markdown and highlighted code are rendered safely, without executing embedded HTML or scripts.
- **CHAT-009:** Provider errors are mapped to stable application errors, logged with correlation IDs, and never expose credentials or raw sensitive payloads.

### 7.5 Documents

- **DOC-001:** A member can upload PDF, DOCX, or plain-text files within configured size and count limits.
- **DOC-002:** File extension, declared content type, detected signature, size, and safe filename are validated; the object remains private.
- **DOC-003:** Processing has explicit states: uploading, uploaded, queued, processing, ready, failed, quarantined, and deleting. After confirmed purge the document row is absent; `DELETED` is not a stored processing status.
- **DOC-004:** Extraction and chunking occur in an isolated background worker with time, memory, page, and decompression limits.
- **DOC-005:** Extracted text and chunks inherit document/workspace authorization and are not returned across workspaces.
- **DOC-006:** A generated summary is labeled as AI-generated and records source document version, model, prompt version, and usage.
- **DOC-007:** Document Q&A retrieves authorized chunks, marks them as untrusted reference data, and returns source locators where extraction supports them.
- **DOC-008:** A user can delete a document, causing derived content and stored objects to follow the retention policy.
- **DOC-009:** Failed or unsupported extraction produces an actionable error; the product must not manufacture extracted text or a summary.

### 7.6 Knowledge

- **KNOW-001:** A member can create, view, edit, delete, and organize knowledge items in a workspace. Archive is deferred unless an explicit lifecycle is added to the data and API contracts.
- **KNOW-002:** Knowledge items support plain text or safely rendered Markdown and defined source metadata.
- **KNOW-003:** PostgreSQL full-text search initially covers titles and content with workspace scope and deterministic pagination.
- **KNOW-004:** Chat or document outputs are copied to knowledge only after an explicit user action, preserving provenance.
- **KNOW-005:** Retrieval for AI respects the same authorization and prompt-injection boundaries as document retrieval.

### 7.7 Workflows

- **FLOW-001:** An Owner or Admin can create and edit a draft workflow from a versioned, allow-listed node catalog; a Member can run an allowed published workflow but cannot author one by default.
- **FLOW-002:** The visual editor validates node configuration, connection compatibility, required inputs, cycles, and limits before publication or execution.
- **FLOW-003:** Publishing creates an immutable workflow version; later edits create a new draft/version.
- **FLOW-004:** Execution is server-controlled with input schema validation, step/time/token/concurrency limits, cancellation, and idempotency protection.
- **FLOW-005:** No node may execute arbitrary code, shell commands, raw SQL, unrestricted filesystem operations, or arbitrary network requests.
- **FLOW-006:** Each execution and step records safe status, timings, relevant resource references, usage, and sanitized errors.
- **FLOW-007:** Execution history is workspace-authorized and observes the log retention policy.

### 7.8 Usage and quotas

- **USE-001:** Every provider attempt records user, workspace, capability, provider/model, token counts when supplied, status, and timestamps.
- **USE-002:** Cost values are estimates based on a versioned pricing snapshot and must be labeled as estimates, never invoices.
- **USE-003:** Quotas are enforced on the server before starting controlled work, with reconciliation after actual usage is known.
- **USE-004:** Users can view aggregated usage by time period and model for authorized workspaces.
- **USE-005:** Retries and failed/cancelled requests retain sufficient data to reconcile real provider cost without double-counting a logical request.

### 7.9 Notifications and settings

- **NOTIF-001:** A user can list, mark read/unread, and retain a paginated notification history.
- **NOTIF-002:** Notifications link only to resources the recipient is currently authorized to view.
- **SET-001:** Profile, security, and AI preferences use validated forms with success/error feedback.
- **SET-002:** Preference changes affecting privacy, sessions, or model behavior are auditable.
- **SET-003:** A Member can request a private, asynchronous export of their own portable data within one workspace; only the Owner can request the whole-workspace scope. Status, short-lived download, expiry, and cleanup remain authorized and visible without exposing internal storage keys.

### 7.10 Administration

- **ADMIN-001:** Platform administration is a separate platform role, not inferred from workspace ownership.
- **ADMIN-002:** Admin routes and APIs verify the platform role on every request.
- **ADMIN-003:** User management, usage analytics, audit inspection, and platform-setting changes are individually authorized and audited.
- **ADMIN-004:** Every production platform-admin session requires MFA; high-risk actions additionally require confirmation and recent re-authentication. Impersonation is out of initial scope.
- **ADMIN-005:** Admin screens minimize exposure of user content and personal data.

## 8. Role and capability baseline

This is the proposed product-level matrix; the server authorization policy remains authoritative.

| Capability | Owner | Admin | Member | Platform admin |
|---|:---:|:---:|:---:|:---:|
| View workspace resources | Yes | Yes | Yes | Only through explicit admin policy |
| Create chat/document/knowledge resources | Yes | Yes | Yes | No implicit access |
| Update/delete own ordinary content | Yes | Yes | Yes | No implicit access |
| Manage all ordinary workspace content | Yes | Yes | No | No implicit access |
| Manage workspace settings | Yes | Yes | No | No implicit access |
| Invite/remove Members | Yes | Yes | No | No implicit access |
| Invite/promote/demote/remove Admins | Yes | No | No | No implicit access |
| Transfer ownership/delete workspace | Yes | No | No | No implicit access |
| Create/edit/publish workflows | Yes | Yes | No | No implicit access |
| Run published workflows | Yes | Yes | Yes, policy/quota controlled | No implicit access |
| Access platform administration | Only if separately assigned | Only if separately assigned | Only if separately assigned | Yes |

The first-release baseline uses this fixed matrix and workspace-visible content for team workspaces. A personal workspace is the sole-owner/private special case described by WS-001 and does not permit invitation, added-member, transfer, leave, or direct workspace-deletion capabilities. Per-workspace role customization, private resources, and resource-level ACLs remain open product decisions and require a revised authorization model before implementation.

## 9. UX and design requirements

### 9.1 Visual identity

- premium dark SaaS direction using background `#08090D`, secondary background `#11131A`, primary blue `#2457FF`, burgundy `#650D2D`, text `#F5F5F7`/`#9297A5`, and borders `#252936`;
- a distinctive Code Ninja/NEXUS visual language built through typography, composition, restrained accents, and purposeful motion—not excessive gradients, glow, shadows, or glass effects;
- CSS Modules, global tokens through CSS custom properties, and no Tailwind CSS;
- a documented spacing, type, radius, motion, focus, and component-state system before feature pages proliferate.

### 9.2 Interaction standards

- keyboard-reachable controls, visible focus, semantic structure, associated labels, and meaningful status announcements;
- responsive behavior at content-driven breakpoints, including a collapsible navigation model;
- loading skeletons for stable layouts, empty states that explain the next action, and recoverable error states;
- reduced-motion support and no essential information conveyed by color alone;
- destructive actions use explicit labels and contextual confirmation;
- streaming content must not continually steal focus or make controls move unpredictably;
- dates, numbers, and cost estimates are locale-aware while persisted timestamps remain UTC.

The target is WCAG 2.2 AA for product-owned interfaces. Automated checks supplement, but do not replace, keyboard and screen-reader review.

## 10. Non-functional requirements

### 10.1 Security and privacy

- Follow the controls and testable requirements in `SECURITY_REQUIREMENTS.md`.
- Treat uploaded files, extracted text, retrieved knowledge, chat content, Markdown, and AI output as untrusted.
- Encrypt traffic in transit and rely on managed-service encryption at rest, with credentials separated by environment.
- Do not use customer content to train models under NEXUS control; document provider retention/training terms before launch.
- Define retention, export, deletion, and backup behavior before accepting production content.

### 10.2 Reliability

- Mutating APIs are idempotent where retries are plausible.
- Background jobs are retry-safe, have bounded retry policies, and expose terminal failures.
- Provider, storage, email, queue, and database failures degrade to honest, actionable states.
- Database migrations are reviewed, forward-deployable, and tested against a production-like snapshot strategy.
- Recovery objectives must be agreed before production. Proposed starting targets are RPO <= 24 hours and RTO <= 4 hours, subject to service selection and cost approval.

### 10.3 Performance targets

Targets are service-level objectives to validate with instrumentation, not current claims:

| Journey | Proposed target |
|---|---|
| Authenticated page API, non-AI | p95 server response <= 500 ms under agreed baseline load |
| Search results | p95 <= 750 ms for expected initial corpus |
| Chat time to first streamed content | p95 <= 3 s excluding declared provider outage |
| Upload acknowledgement | <= 2 s after object-store completion |
| Document processing | visible progress; 95% of supported files within an agreed size/page envelope complete <= 5 min |
| Availability | 99.9% monthly for core authenticated experience after production hardening |

Final SLOs require a load model, hosting tier, and error-budget owner.

### 10.4 Maintainability and operability

- strict TypeScript; explicit domain/service boundaries; no database access from presentational components;
- structured logs, trace/correlation identifiers, metrics, and exception monitoring without raw secrets or full sensitive content;
- health/readiness visibility for application and workers;
- unit, integration, and end-to-end coverage focused on authorization and critical journeys;
- documented local setup, migrations, seeding, runbooks, and architecture decisions;
- dependency updates and vulnerability remediation follow a defined cadence.

## 11. Analytics and success measures

Product analytics must be privacy-reviewed and should favor domain events over raw content.

### 11.1 Activation

- verified registration to first completed AI response;
- percentage of new users completing a meaningful action (chat, ready document, saved knowledge item) within 24 hours;
- median time to first meaningful action.

### 11.2 Ongoing value

- weekly active verified users;
- four-week retained users who complete a meaningful action;
- conversations revisited, knowledge items retrieved, and workflows successfully rerun;
- ready-document rate and grounded Q&A completion rate.

### 11.3 Trust and quality guardrails

- authorization-denial anomaly rate and confirmed cross-tenant incidents (target: zero);
- document extraction failure rate by type and size;
- AI/provider error rate and time to first content;
- workflow terminal failure and duplicate-execution rate;
- support-reported misleading success states;
- deletion jobs completed inside the approved retention window.

Exact event schemas, consent requirements, and initial targets are pre-launch decisions.

## 12. Dependencies and assumptions

- A managed PostgreSQL provider supports the required extensions, pooling, backups, and selected deployment region.
- S3-compatible object storage can keep objects private and support short-lived signed operations.
- A transactional email provider and verified sending domain are available for verification and recovery.
- OpenAI credentials and approved model catalog are available; NEXUS uses a provider abstraction rather than exposing provider credentials.
- Distributed Redis coordination is introduced by the first multi-instance AI/chat deployment for rate limits and cancellation; Redis-backed heavy-job queues and isolated workers arrive with document processing. A database-backed outbox dispatcher exists earlier for reliable mail and lifecycle work.
- Legal text, privacy policy, retention policy, provider data terms, quota model, and abuse policy require owner/legal input before production.

## 13. Product risks and missing decisions

| Decision/risk | Why it matters | Required by | Proposed owner |
|---|---|---|---|
| Launch scope and sequence | The complete module list is too large for a single safe release | Phase 1 approval | Product/engineering |
| Regions and data residency | Constrains database, storage, queue, email, and AI routing | Infrastructure selection | Product/security |
| Data retention and deletion window | Affects schema, jobs, backups, legal promises, and cost | Auth/doc implementation | Product/legal/security |
| Provider content retention/training terms | Determines whether sensitive workloads are acceptable | AI integration | Security/legal |
| Plan, quota, and billing model | Shapes enforcement and usage UX even before payments | Usage design | Product/finance |
| Workspace invitation policy | Open invite, domain restriction, expiry, and email behavior affect abuse surface | Workspace phase | Product/security |
| Future Member workflow-authoring delegation | The first-release baseline denies Member authoring/editing/publishing; any expansion changes the RBAC and threat model | Before any role expansion | Product/security |
| Document limits | Needed to size storage, parsing isolation, queues, and cost | Document design | Engineering/product |
| Retrieval quality target | Determines when full-text search is insufficient and pgvector is justified | Document/knowledge beta | Product/AI |
| Export format and portability | Required for credible account deletion and user trust | Pre-launch | Product/engineering |
| Platform-admin operating model | Determines MFA, staffing, audit review, and break-glass process | Admin phase | Operations/security |
| Accessibility acceptance process | Requires named reviewers and supported browser/assistive-tech matrix | Design system | Product/QA |

## 14. Acceptance of this specification

Phase 0 acceptance means stakeholders agree that this document is a planning baseline, that unresolved items are visible, and that architecture, data, API, security, and roadmap documents are mutually consistent. It does **not** mean any feature is implemented.

Any material scope or trust-boundary change should update this specification and the affected architecture decision before implementation.
