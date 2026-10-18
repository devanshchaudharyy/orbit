# Phase progress

Current status: Phase 14 release hardening and deployment preparation are in progress. See [the current report](PHASE14_REPORT.md). Phase 13 is complete and published with successful full Compose CI. Public hosting is pending by user choice. Live Stripe sandbox verification and Windows Docker/WSL/named-volume restart acceptance remain explicitly deferred. Llama remains unloaded. Earlier sections are historical records.

## Phase 0 — foundation implemented; infrastructure verification blocked

Date: 10 October 2026 (Asia/Kolkata).

### Implemented

- Local Git repository, pinned pnpm/Node toolchain, strict TypeScript ESM workspace packages, one lockfile, explicit exports.
- Modular Express API with validated configuration, structured redacted logging, request IDs, security headers, bounded dependency health, safe errors, and graceful shutdown.
- Docker Compose definition for authenticated MongoDB replica set, persistent Redis, private Garage storage, and captured local email; generated ignored credentials and idempotent initialization.
- Original ORBIT tokens/artwork, complete dark/light/system appearance, source-owned Radix UI primitives, responsive interactive lab, keyboard palette, local validation and component-state examples.
- Real browser-to-API health integration and truthful unavailable-service feedback.
- Unit/component/API tests, browser and axe tests, infrastructure CLI, and GitHub Actions configuration.
- README, environment template, architecture/database/API/design/testing documentation.

### Added/changed files

The empty repository was populated under `apps/web`, `apps/api`, `packages/ui`, `packages/contracts`, `packages/config`, `infra`, `scripts`, `tests/e2e`, `.github/workflows`, and `docs`, together with root package/tooling files. The [Phase 0 file inventory](PHASE0_FILES.md) lists every added file. There are no previous feature implementations to regress.

### APIs and database changes

Only `GET /api/v1/health/live` and `GET /api/v1/health/ready` exist. No business endpoints/models or production records were created. The real integration CLI creates isolated temporary test artifacts only after successful local-service connections.

### Verification results

| Executed check                      | Result                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Dependency installation             | Passed; pinned dependencies and strict peer checks; esbuild build script explicitly allowed                                     |
| Local configuration generation      | Passed; ignored credentials and Garage configuration generated without printing secrets                                         |
| `pnpm format:check`                 | Passed                                                                                                                          |
| `pnpm lint`                         | Passed with zero warnings                                                                                                       |
| `pnpm typecheck`                    | Passed across all TypeScript packages                                                                                           |
| `pnpm test`                         | **30 passed**, five test files; includes logging redaction and local-only infrastructure guard checks                           |
| `pnpm build`                        | Passed for contracts, API, and default production frontend                                                                      |
| `node scripts/check-production.mjs` | **3 passed**: lab excluded at `/` and `/dev/design-system`; lab content excluded from production JavaScript                     |
| `pnpm test:e2e`                     | **14 passed**; real Chromium, six theme/viewport axe scans with zero WCAG A/AA violations, no unexpected console/runtime errors |
| `pnpm infra:up`                     | Blocked: Docker executable unavailable                                                                                          |
| `pnpm infra:check`                  | **4 failed**, zero passed: MongoDB authentication/connection, Redis, S3, local SMTP/capture checks                              |
| GitHub Actions                      | Configured; not executed remotely                                                                                               |
| Container-restart durability        | Not executed; requires Docker                                                                                                   |

Browser verification covered live API status, redirects/direct-route refresh, 375/768/1440px layouts in both themes, persisted/system appearance, form validation and controls, dialog focus containment/restoration, drawer appearance, keyboard palette navigation, mobile navigation, menus, state tabs, table selection, clipboard output, and reduced motion. Desktop dark/light and mobile captures were visually inspected. Contrast issues found during the first browser pass were corrected before passing verification.

Screenshots are retained in [the screenshot directory](screenshots/): `lab-{dark,light}-{375,768,1440}.png`. The API liveness boundary responds HTTP 200; unavailable dependencies propagate HTTP 503 through the shared contract and render truthful feedback in the lab. No database-backed feature or durable service check is reported as passed.

### Known limitations

Docker Desktop and WSL are missing. MongoDB connection/authentication, Redis, S3, and SMTP checks have not succeeded with this project’s generated configuration. Transaction rollback, private object handling, captured email, and container-restart durability therefore remain unverified on this machine. The local API reports HTTP 200 for liveness and HTTP 503 for aggregate readiness.

No remote repository, GitHub workflow run, deployment, cloud services, charges, OAuth, AI, or real billing integrations have been created. Tenant/session architecture is documented but belongs to later phases. The gallery’s sample data and local form actions are clearly component demonstrations.

### Unblocking infrastructure

Follow TESTING.md to install/verify WSL and Docker Desktop, resolve any occupied local service ports, then execute `pnpm infra:up` and `pnpm infra:check`. Run the documented container-restart sentinel check. Record the real results here before marking infrastructure verification complete.

### Preparation for Phase 1

The reusable UI/token package was prepared for the marketing website. The default production frontend excludes the development lab. The user subsequently authorized Phase 1; its results follow.

## Phase 1 — marketing website

Date: 10 October 2026 (Asia/Kolkata). [Full implementation and verification report](PHASE1_REPORT.md).

Implemented the public homepage, original responsive product presentation, local Board/List/filter/task demonstrations, guided tour, native section navigation, mobile menu, proposed monthly/yearly plan comparison, plan dialogs, FAQs, 404 recovery, and shared theme controls. Default production builds now serve marketing at `/` and continue excluding the lab. No new service, dependency, business collection, authentication, or billing operation was introduced.

Verification covers strict types, unit/component/API regression, production builds and route gating, and Chromium/axe checks at 375/768/1440px in both themes. Screenshots are retained in `docs/screenshots/marketing-{dark,light}-{375,768,1440}.png`.

| Command                                          | Executed result                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                      | Passed, zero warnings                                                                                                                                             |
| `pnpm format:check`                              | Passed                                                                                                                                                            |
| `pnpm typecheck`                                 | Passed across all packages                                                                                                                                        |
| `pnpm test`                                      | **33 passed**, six files                                                                                                                                          |
| `pnpm build`                                     | Passed: contracts, API, public marketing frontend                                                                                                                 |
| `node scripts/check-production.mjs`              | **3 passed**: marketing homepage, lab route gated, lab JavaScript excluded                                                                                        |
| `pnpm test:e2e`                                  | **25 passed**: 14 lab regression checks and 11 marketing checks; 12 theme/viewport axe scans with zero WCAG A/AA violations; no unexpected console/runtime errors |
| `pnpm infra:check`, container restart, remote CI | Not executed in Phase 1; Phase 0 blockers retained                                                                                                                |

Phase 0's Docker/WSL and infrastructure blockers remained unchanged at the Phase 1 handoff. Integration and restart durability were not rerun for that presentation-only phase. The user subsequently authorized Phase 2 and deferred Docker installation; account verification uses the isolated fixture described below.

## Phase 2 — accounts and personal onboarding

Date: 10 October 2026 (Asia/Kolkata). [Implementation and verification report](PHASE2_REPORT.md).

Implemented real registration, Argon2id passwords, email verification and password recovery, Mongo-backed opaque cookie sessions, session-bound CSRF and Origin checks, persistent abuse controls, idle/absolute expiry, profile updates, verified personal onboarding, current-password changes, active session review, individual revocation, and sign-out everywhere. Password reset/change invalidate sessions transactionally; login uses a credential write fence against concurrent reset. Marketing CTAs now open the account pages.

Shared strict contracts, API auth module/controller/service/repository boundaries, configuration/log redaction, browser auth state/guards/forms/account layouts, environment setup, isolated verification tools, production-route checks, Compose-backed CI harness, tests, and documentation were added or updated. The only new direct library is exactly pinned `argon2@0.45.1`; its native build is explicitly allowed. No provider account was provisioned.

New database collections: `auth_users`, `auth_sessions`, `auth_tokens`, and `auth_rate_limits`. APIs are documented under `/api/v1/auth`; health behavior remains intact. Personal onboarding creates no tenant membership or workspace. Business CRUD, collaboration, AI, billing, and deployment remain in their designated phases.

The real auth fixture uses MongoDB 8.3.4, Mailpit 1.27.10, and separate API4001/frontend5174 ports. These results are separate from the unexecuted Docker stack checks.

| Command / check                                    | Executed result                                         |
| -------------------------------------------------- | ------------------------------------------------------- |
| Dependency installation and environment generation | Passed; frozen lockfile and preserved local credentials |
| `pnpm typecheck`                                   | Passed                                                  |
| `pnpm test`                                        | **77 passed**, 12 files                                 |
| `pnpm build`                                       | Passed                                                  |
| Production route/build checks                      | **5 passed**                                            |
| Marketing/lab browser regression                   | **25 passed**, 12 axe scans with zero violations        |
| Auth API/database/email integration                | **15 passed**                                           |
| Auth MongoDB transaction checks                    | **3 passed**                                            |
| Auth browser verification                          | **9 passed**, 32 axe scans with zero violations         |
| Local fixture status and harness guard checks      | Passed                                                  |
| Docker stack, container restart, remote CI         | Not executed; deferred infrastructure acceptance        |

`pnpm lint` passed with zero warnings, and `pnpm format:check` passed. [Screenshots](screenshots/) include both themes at 375/768/1440px for auth forms, verified onboarding, and account profiles, plus session/security tabs. The full flow connects the browser through the API to actual MongoDB records and captured SMTP email; tests clean their unique synthetic artifacts. Phase 2 implementation and independent verification are complete; full Docker acceptance remains deferred.

### Deferred acceptance

The user chose to install Docker and WSL later. Docker Compose MongoDB 8.0.17, Redis, Garage, and container restart durability are not verified by the auth fixture. After installing the documented prerequisites and resolving occupied Compose ports, run `pnpm infra:up`, `pnpm infra:check`, and `pnpm test:auth:compose`, followed by the documented restart sentinel check. Record those actual results before marking the full infrastructure acceptance complete.

### Preparation for Phase 3

Verified user identity and personal onboarding were prepared for organization/workspace membership checks. The user subsequently authorized Phase 3 and its GitHub commit; results follow.

## Phase 3 — organizations and workspaces

Date: 10 October 2026 (Asia/Kolkata). [Plan](PHASE3_PLAN.md) and [implementation/verification report](PHASE3_REPORT.md).

Implemented the persistent `/app` area with organization creation, multiple workspaces, organization/workspace switching, settings, and account navigation. Four real MongoDB collections store tenant resources and explicit membership. Creation is atomic with creator grants. Every endpoint checks verified/onboarded identity, organization membership, matching workspace parent, and explicit workspace membership. Owners/admins retain organization administration; members/guests with workspace grants are read-only. No invitations or membership-management routes are introduced.

Settings update transactionally with optimistic versions and membership write fences. A background refetch cannot replace the version paired with the user's edits. Lists are bounded at 50 records with canonical cursors. Query caches include identity and verified resource scope and clear on identity changes/sign-out. Original responsive workspace screens, creation dialogs, a mobile navigation drawer, loading/empty/error/success states, keyboard focus, and all three appearance preferences are implemented.

Executed independent checks include **86 unit/component/API tests**, **21 real MongoDB/Supertest tenant checks**, **6 tenant browser scenarios**, **38 tenant axe scans with zero violations**, **7 production route checks**, strict TypeScript, production builds, **15 account integration checks**, and **3 account transaction regressions**. Exact final command results, prior browser regressions, screenshot evidence, and limitations are kept in the report. The gallery retains **36 new Phase 3 screenshots** in both themes at 375/768/1440px.

The previous GitHub workflow failed at Mongo's health check. The command now recognizes the observed `replication.replSet` field as well as `replSetName`. Docker/WSL remain deferred; local Compose acceptance, Redis/Garage, and restart durability are not counted as passed. Recover with the commands in TESTING.md and the phase report. New remote CI results are reported independently after the phase is pushed.

### Preparation for Phase 4

Explicit organization/workspace authority records, unique membership indexes, owner/admin checks, transaction fences, and resource navigation prepared Phase 4. The user subsequently authorized it; results follow.

## Phase 4 — teams, lifecycle and permissions

Date: 10 October 2026 (Asia/Kolkata). [Plan](PHASE4_PLAN.md), [verification report](PHASE4_REPORT.md), and [screenshots](SCREENSHOTS.md).

Implemented SMTP invitations with hashed, email-bound, seven-day single-use credentials; explicit acceptance; pending lists/revocation; roles including project manager; workspace grant replacement; member removal; leaving; and current-password ownership transfer. Owners control admins/ownership, admins control lower roles, and organization administration never bypasses workspace membership. Transaction fences coordinate races and member versions reject stale edits. Removal/leave clears all workspace grants and affected pending links.

The original responsive Team & access page includes private rosters, role badges, explicit workspace checkboxes, invitation/access overlays, confirmations, unavailable/error/conflict/pending/success states, and a non-admin access explanation. New invitees can register, verify email and complete onboarding before returning to explicit acceptance. Tokens survive SPA navigation in tab memory only; refreshed scrubbed links require reopening email. Public marketing/account/resource behavior remains intact.

Added the `teams` API module, contracts, invitation indexes, service/persistence separation, browser pages/hooks/styles, unit/integration/browser checks and CI coverage. Extended existing organization membership versions/roles and organization teamRevision. Updated README, architecture, database, API, design, testing, gallery and progress. No new dependency or service provisioning. Projects/tasks, realtime, AI, billing and deployment remain future work.

Final executed results and evidence are in the Phase 4 report. The [corrective GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38070127777) completed successfully for `fc01d30caa8eefdf91d0928eda2347fa258be960`, including all checks, pinned Compose infrastructure, and account/tenant/team integration and browser suites. Docker/WSL and local full-stack restart acceptance remain deferred at the user's request. The isolated MongoDB/Mailpit fixture verifies actual account/team persistence and email flows; it does not verify local Redis or Garage. Remote Compose verification does not replace the deferred Windows container-restart sentinel. Production preview detection and Linux keyboard accessibility fixes are documented in the report.

### Preparation for Phase 5

Verified tenant parents, current membership, explicit workspace grants, hierarchy rules, optimistic versions and write fences prepared Phase 5. The user subsequently authorized it; results follow.

## Phase 5 — projects and tasks

Date: 11 October 2026 (Asia/Kolkata). [Plan](PHASE5_PLAN.md), [verification report](PHASE5_REPORT.md), [screenshots](SCREENSHOTS.md).

Implemented persistent project creation/settings, owners/team/guest grants, status/priority, original vector covers, blank/launch templates, archive/restore and atomic soft deletion. Tasks/subtasks include descriptions, status, priority, due dates, owner, multiple assignees, checklists and project labels. Combined server filters persist in the URL; actual active task counts drive progress. Transactional append-only history records mutations and status changes.

Explicit organization/workspace membership precedes project access. Workspace owners/admins/project managers manage projects; eligible project owners manage their own project. Other members need explicit grants for task work; explicitly granted guests are read-only. Assignments/grants require current eligible members. Versions prevent stale overwrites and transaction retries recheck authority. Deletion and label cleanup preserve multi-record invariants and history.

Browser routes, queries, forms and original responsive layouts are integrated with actual API/MongoDB persistence. Final local verification passed 107 unit/component/API tests, 92 real integration/transaction checks, 50 browser scenarios, 184 axe scans with zero violations and 12 production checks. Project-specific coverage includes 28 integration checks, five browser scenarios and 54 axe scans. Exact commands, publication and CI results are recorded in the report. Local Docker/WSL and restart acceptance remain deferred; no deployment or provider provisioning.

The [corrective Phase 5 GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38115337823) completed successfully for `740bfb08405c49290739a3deeae419384d59c5f0`, including pinned Compose infrastructure, all checks/builds and account/tenant/team/project browser/integration suites. All five project browser scenarios passed directly with no flaky result reported. The initial successful run's route-capture race and its verified correction are documented in the report. The private repository contains the code, README and 183 retained screenshots; the final evidence update changes documentation only.

### Preparation for Phase 6

Scoped project/task contracts, statuses, assignments, labels, stable IDs, URL filters, bounded cursors, optimistic versions and transaction fences prepared Phase 6. The user subsequently authorized it; current progress follows.

## Phase 6 — work views and preferences

Date: 11 October 2026. [Plan](PHASE6_PLAN.md), [current report](PHASE6_REPORT.md).

Implemented shared list/Kanban/table/calendar task views, sorting/grouping, inclusive UTC month filtering and an undated collection. Moves update only status/date with original task versions and transactional activity. All views retain current organization/workspace/project authorization. Guests manage their own saved settings while remaining read-only for work.

Personal per-project defaults persist view, sorting, grouping, density, week start, table columns and subtask visibility. Up to twenty private named filters persist validated query choices; versions reject concurrent settings/filter edits. Explicit URL choices override defaults. Loaded and actual matching counts are visible with bounded pagination. Pointer handles and equivalent Move dialogs support status/date changes; manual within-column ranking is outside this phase.

Local verification passed: **121 unit/component/API tests**, **116 real integration/transaction checks**, **55 browser scenarios**, **238 accessibility scans with zero violations**, and **12 production route/build checks**, plus strict types, lint and production builds. This includes 24 new view database checks and five new view browser scenarios with 54 theme/viewport/overlay scans. All final browser suites passed without retries. The gallery retains **54 new screenshots**, **237 PNGs** across phases. Test-discovered empty-filter persistence, form labeling and removed-task focus restoration issues have fixes and regression coverage. The earlier execution-approval usage limit is resolved.

Phase 6 is complete and published to the existing private repository. The [GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38150192862) completed successfully for **`8d089da35e3caab20c78110943b30eca2a3514bc`**, including pinned Compose infrastructure, all checks/builds, 116 application integration/transaction checks and 55 browser scenarios passed directly, with no flaky result reported. Exact publication/CI evidence is in the report. The final evidence commit changes documentation only. Docker/WSL and Windows container restart acceptance remain deferred; exact recovery commands are documented. No paid service or deployment was introduced. The user subsequently authorized Phase 7; its results follow.

## Phase 7 — delivery planning

Date: 12 October 2026. [Plan](PHASE7_PLAN.md), [verification report](PHASE7_REPORT.md), [screenshots](SCREENSHOTS.md).

Implemented milestones with explicit delivery and actual linked-task progress; planned/active/completed sprints with one active sprint, frozen commitment/delivery and explicit unfinished-task carryover; original timeline/Gantt with same-project finish-to-start dependencies; entered-estimate workload and capacity; project-wide delivery tracking. Five URL-addressable tabs reuse current task filters, status moves, semantic themes and accessible dialogs. No new dependency or provider was introduced.

Strict contracts, scoped backend module, four indexed planning collections, transactional activity and graph/lifecycle/membership fences protect current authority and original versions. Guests are read-only, archives reject writes and revoked/deleted parents deny access. Existing task edits/moves preserve planned start/due ordering. Forecast follows all filtered pages, while global delivery summaries remain project-wide. Unknown effort/capacity, unassigned and unscheduled work remain visible.

Final local verification passed **136 unit/component/API tests**, **148 real integration/transaction checks**, **61 browser scenarios**, **304 axe scans with zero violations**, and **12 production checks**, plus types, lint and builds. All final browser suites passed directly. Planning adds 32 real database checks, six browser scenarios and 66 audited screenshots; the retained gallery totals 303 PNGs. Exact commands, fixes, formatting/publication audits and current CI evidence are recorded in the report. Local Docker/WSL and Windows container-restart acceptance remain deferred; full Compose CI evidence is reported separately. Phase 8 has not started. No deployment, paid provisioning or user-account business-data seed.

Phase 7 is complete and published to the existing private repository. The [corrective GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38271056842) completed successfully for **`f1656dd8bf338d79c401869d23b41deee69c5453`**, including four pinned infrastructure checks, 136 tests, 148 application integration/transaction checks, 61 browser scenarios and 12 production checks. All browser suites passed directly, with no failed or flaky result reported. The report records the earlier filter-refresh failure and its verified correction. The final evidence commit updates documentation only; Windows Docker/WSL and restart acceptance remain deferred. The user subsequently authorized Phase 8; current work follows.

## Phase 8 — real-time collaboration

Date: 13 October 2026. [Plan](PHASE8_PLAN.md), [verification report](PHASE8_REPORT.md), [screenshots](SCREENSHOTS.md).

Implemented real-time project/task/planning/history updates, task/subtask comments, project team discussions, explicit mentions, private project inboxes with read/unread flags and deep links, and distinct live viewers. Plain-text messages, versions, retry identifiers, recipient notifications and activity persist transactionally behind current tenant/resource grants. Guests and archives remain read-only; revoked sessions/resources remove live access and open overlays. Local drafts and original versions remain stable during updates; conflicts require explicit reload.

Socket.IO 4.8.4 uses same-origin WebSockets, exact Origin, cookie sessions, CSRF and server-authorized project rooms. Committed MongoDB streams send scoped invalidations without content; REST/reconnect recovers missed work. Passive checks do not extend idle expiry. Degraded/offline feedback and reconnect are explicit. Presence is process-local and deduplicated; one API process is supported. No files, AI, billing, worker, multi-node adapter or deployment is introduced.

Final local verification passed 148 unit/component/API tests, 178 real integration/transaction/socket checks, 69 browser scenarios, 364 axe scans with zero violations and 15 production checks, plus types, lint, formatting and builds. All final browser suites passed directly. The gallery retains 60 new captures, totaling 363 PNGs. The planning regression exposed a live-refresh/explicit-reload race; serialized refreshes and a pending-until-rendered reload fix passed the original conflict test and both full affected suites.

Phase 8 is complete and published to the existing private repository. The [GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38420224406) completed successfully for **`11ac996adba48bd5f9992cab3315e7c581176b34`**: frozen installation, all checks/builds, four pinned Compose infrastructure checks, 148 tests, 178 application integration/transaction/socket checks, 69 browser scenarios and 15 production checks passed. All browser suites passed directly; no failed or flaky result was reported. The final evidence commit changes documentation only. Windows Docker/WSL and restart acceptance remain deferred, with exact recovery commands documented. No deployment, paid provisioning or user-account business-data seed. Phase 9 was subsequently authorized; its verification is recorded in the current report.

## Phase 9 — documents and files

Date: 14 October 2026. [Plan](PHASE9_PLAN.md), [verification report](PHASE9_REPORT.md), [screenshots](SCREENSHOTS.md).

Implemented safe shared rich-text documents, immutable history and restore, original-version conflicts and live draft preservation. Private project/task/subtask/document attachments support validated uploads, real image/text/PDF previews and downloads, rename/removal, literal search and bounded paging. Current membership, guests, archives and deleted parents are enforced by the API. Durable pending intents, UUID/fingerprint deduplication, transactional finalization/activity and bounded cleanup coordinate MongoDB with private disk/S3 storage.

Phase 9 is complete and published as application commit `03c0d73d4e15ba600f3070797a0a920c018b97f5`. Local verification passed **177** tests, **205** integration/transaction/socket/storage checks, **74** browser scenarios, **436** axe scans with zero violations and **18** production checks, plus types, lint, formatting and builds. All local browser scenarios passed directly. The gallery retains 72 new captures, totaling 435 PNGs.

The [GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38522283565) completed successfully, including pinned Compose services and actual private Garage document/file integration and browser flows. One earlier project deletion scenario required a retry; all five new document scenarios passed directly. Exact evidence and the existing flaky assertion follow-up are recorded in the report. The final evidence commit changes documentation only. Windows Docker/WSL and restart acceptance remain deferred. No deployment, paid provisioning or business-data seed.

The user subsequently authorized Phase 10; its implementation follows.

## Phase 10 — analytics and reports

Date: 14 October 2026. [Plan](PHASE10_PLAN.md), [verification report](PHASE10_REPORT.md), [screenshots](SCREENSHOTS.md).

Implemented project completion/status, overdue work, planned workload/capacity, milestone progress, recorded activity trends, frozen sprint velocity, observed burndown, custom UTC dates and six private CSV datasets. Current tenant/project grants protect every report and download, including guests, archives and revoked grants. Missing estimates and historical observations remain explicitly unavailable. Transactional observations roll back with failed mutations; completed delivery snapshots survive later task edits.

Recharts charts include keyboard inspection, equivalent tables, series/unit controls and reduced motion. CSV exports use consistent columns, Unicode, formula neutralization and bounded resource reads. No synthetic business data, performance score, AI, billing or deployment is introduced.

Local verification passed 198 tests in 30 files, 230 application integration checks, 78 browser scenarios, 508 axe scans with zero violations and 20 production checks, plus strict types, lint and builds. All local browser scenarios passed directly. The gallery retains 72 new captures, totaling 507 PNGs. The [GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38600797715) passed for `0fcb88826bb0ab0424bfdf6bd2bb73124796d40c`, including four pinned infrastructure checks and the full application suite. All remote browser scenarios passed directly, with no failed or flaky result reported. The final evidence commit updates documentation only. Windows Docker/WSL and named-volume restart acceptance remain deferred. The user subsequently authorized Phase 11; current work follows.

## Phase 11 — AI assistance and workflow automation

Implemented 15 October; verification continued 16 October 2026. [Plan](PHASE11_PLAN.md), [verification report](PHASE11_REPORT.md), [screenshots](SCREENSHOTS.md).

Implemented eight local Ollama modes, bounded current project context, private durable history, structured output validation and transactional quotas. Task/subtask and priority proposals support editing, selection and explicit confirmed application with fresh authority, exact-context checks, atomic rollback and duplicate prevention. Guests remain read-only. No model tools, automatic task changes, outbound messages or cloud fallback are configured.

Manager-controlled daily risk and weekly status workflows require explicit delegation and default to paused. A separate BullMQ worker uses MongoDB due records, identifier-only Redis jobs, fresh authorization/version checks, bounded retries, catch-up and operational heartbeats. Pausing or revoking access prevents stale output publication. Model availability and worker connectivity have separate feedback.

Phase 11 is complete and published as application commit `eab2e8948b8a11020afb9ef85fe0e92a38891d6d` in the existing private repository. Full [GitHub verification](https://github.com/devanshchaudharyy/orbit/actions/runs/38860050962) passed: 232 tests, 265 application integration checks including six real Redis worker checks, four infrastructure checks, 21 production checks and 82 browser scenarios completed successfully. An earlier collaboration revocation-overlay scenario passed on its first retry; the other 81 scenarios, including all four new AI scenarios, passed directly. The report records the five-second assertion/polling timing limitation for later hardening.

Local verification passed 232 tests, 259 application integration checks, 82 browser scenarios, 580 axe scans with zero violations and 21 production checks. The planning suite passed all six scenarios on its full rerun after an earlier timeout. Two small synthetic live Ollama provider cases and a supplemental real preview/browser generation-persistence check passed; these are not a model benchmark. The gallery retains 72 new screenshots, totaling 579 PNGs. Llama was then unloaded at the user's request, with no loaded models reported. The final evidence update changes documentation only. Local Redis execution, Windows Docker/WSL and named-volume restart acceptance remain deferred; CI results are separate evidence. No paid provisioning, deployment or business-data seed. Phase 12 has not started.

## Phase 12 — test-mode subscriptions implemented and published

Implemented 16 October; verification completed 18 October 2026. [Plan](PHASE12_PLAN.md), [report](PHASE12_REPORT.md), [sandbox setup and recovery](BILLING.md).

Free, Pro and Business plans use organization billing boundaries, actual resource usage and atomic workspace/project limits. Paid CSV exports and enabled scheduled AI workflows are enforced on the server, including worker execution and output commit. Downgrades retain existing work. Owners explicitly confirm test Checkout/Portal actions; owners/admins can read private paginated invoices. Current canonical provider state and raw signed webhooks determine entitlements. Stable durable checkout identities, exact price quotes, lost-response recovery and reconciliation before another checkout protect retries and missed webhooks.

Application commit `a451275b696f58f7d46597446655916050e479d1` is published in the private repository. [Full CI](https://github.com/devanshchaudharyy/orbit/actions/runs/39104067047) passed 245 tests across 36 files, 297 application integration checks including six real Redis worker checks, four infrastructure checks, 22 production checks and all 87 browser scenarios directly, without retries. Local checks passed 245 tests, 291 application integration checks, 87 browser scenarios and 22 production checks. The new billing browser scenarios include 54 axe scans with zero violations across dark/light at 375/768/1440. The gallery retains 54 new billing screenshots, totaling 633 PNGs.

Billing uses the actual Stripe SDK against explicit deterministic HTTP fixtures for tests; these are not live hosted sandbox acceptance. The user deferred live Stripe verification, and normal billing remains unavailable without configured test credentials. Windows Docker/WSL and named-volume restart acceptance remain deferred. No charge, deployment, paid provisioning, business-data seed or model load. Ollama reports no loaded models. Phase 13 has not started.

## Phase 13 — discovery and administration

Completed 18 October 2026. [Plan](PHASE13_PLAN.md), [verification report](PHASE13_REPORT.md), [operating guide](ADMINISTRATION.md), [screenshots](SCREENSHOTS.md).

Implemented global name/title search across six authorized resource types, scope/type/archive filters, bounded cursor pages and fresh permission checks. The full search page and Ctrl/Cmd+K palette support real API results, keyboard navigation and focus restoration. Private versioned notification preferences control future mention/task-comment inbox delivery. Owners/admins receive actual usage, paginated audit metadata and calendar controls. Audit records omit content and expire after 180 days. Authenticated calendar exports require explicit organization enablement and current project access; downloads are private manual imports with bounded date/task windows. The user selected these integrations; no external calendar account or synchronization was introduced.

Application commit `513dc0422e74652f5fbe59525e12f4a24df87014` is published in the private repository. [Full CI](https://github.com/devanshchaudharyy/orbit/actions/runs/39110060786) passed 255 tests across 39 files, 320 application integration checks including six real Redis worker checks, four infrastructure checks, 25 production checks and all 94 browser scenarios directly, without retries or reported flaky results. Local checks passed 255 tests, 314 application integration checks, 94 browser scenarios and 25 production checks. New administration coverage includes 23 integration checks, seven browser scenarios and 60 axe scans with zero violations in both themes at 375/768/1440. The gallery retains 60 new captures, totaling 693 PNGs. The report records corrected attachment-parent filtering, empty-page continuation and palette focus regressions.

The final evidence commit changes documentation and refreshed screenshots only. Live Stripe sandbox verification, Windows Docker/WSL and named-volume restart acceptance remain explicitly deferred. Remote Compose evidence includes private Garage storage and real Redis worker checks; local AI regression used the deterministic HTTP provider. No model load, deployment, paid provisioning, charge or business-data seed. Llama remains unloaded. Phase 14 has not started.
