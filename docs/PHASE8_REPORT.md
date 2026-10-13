# Phase 8 — real-time collaboration

Date: 13 October 2026 (Asia/Kolkata). Scope: real-time work updates, task comments, explicit mentions, private project notifications, presence, project discussions and the existing activity feed. [Plan](PHASE8_PLAN.md). Phase 9 has not started.

## Implemented behavior

Authorized project pages expose **Collaboration**, with a shared discussion and **My project inbox**; task/subtask pages include comment threads. Plain-text messages persist in MongoDB with original versions, explicit mention selection and content-clearing deletion tombstones. Authors edit their own messages; authors and current project managers/owners remove messages. Guests are read-only and archived projects reject message writes. Parent/resource membership is checked on every operation and recipient selection. Revoked display identities become `Former collaborator`.

Task comments notify current owners/assignees and explicitly mentioned eligible collaborators, excluding the author. Project discussions notify selected collaborators. Notifications are private, in-app and scoped to the current project; their read/unread flags are idempotent and reversible. Current message excerpts are joined when reading, so removed messages/tasks disappear. Links address the actual conversation/message, including messages beyond the first page and direct-route refresh. No email notifications, document attachments or global inbox are introduced.

Retry UUIDs prevent duplicate messages/notifications/activity after a lost response. Conflicting reuse fails. Original versions protect edits/deletion and failed/stale writes preserve local drafts until explicit reload/resubmission. Message, recipient notifications and history commit sequentially in one fenced MongoDB transaction. Fifty-row cursor pages, ten mentions, 4,000 characters and a 20,000-message project bound keep reads/writes explicit and bounded.

Socket.IO 4.8.4 attaches to the persistent Node HTTP server and same-origin WebSocket proxy. Exact Origin, opaque cookie sessions, CSRF and verified onboarding guard connection/subscription. Each socket has one server-verified project room; client room names cannot grant access. Current identity/project authorization is rechecked before refresh/presence delivery, on committed authority changes and at five-second intervals. Passive socket checks do not renew idle expiry. Revocation/expiry/deletion removes subscriptions, presence and private cached content; open task overlays close on revocation.

Committed MongoDB change streams send only scoped invalidations, with no message/task content. REST remains durable and reconnect/recovered streams resynchronize missed changes. Task/planning/history/comments update across sessions while open forms retain their original versions/drafts. Presence deduplicates users across tabs and displays twenty names with an actual total. The live panel reports connected, degraded and offline states and offers reconnect. Client invalidations coalesce over 200ms; the general IP request budget is 600/minute to accommodate authorized multi-session refetches. Existing sign-in and mutation budgets remain stricter.

This phase supports one API process, at most 200 sockets and eight per user. Redis remains an independent readiness dependency; no multi-node adapter or worker was added. Missing Redis still yields aggregate readiness HTTP503. Socket.IO disconnect/recovery behavior follows the [official middleware](https://socket.io/docs/v4/middlewares/) and [delivery guidance](https://socket.io/docs/v4/delivery-guarantees/); committed invalidations use [MongoDB change streams](https://www.mongodb.com/docs/drivers/node/current/monitoring-and-logging/change-streams/).

## Verification

The owned fixture uses MongoDB8.3.4 replica set `orbit-test`, database `orbit_test_phase2`, Mailpit1.27.10, API4001 and frontend5174. Tests create and clean unique synthetic users/resources; no business data is seeded into user accounts. Windows Docker/WSL/restart acceptance remains deferred and is separate from fixture results and remote Compose CI.

Final local verification passed **148 unit/component/API tests in 24 files**, **178 real integration/transaction/socket checks**, **69 browser scenarios**, **364 axe scans with zero violations**, and **15 production checks**, plus strict types, lint, formatting and builds. All final browser suites passed directly without retries. Collaboration adds 30 database/socket checks, eight browser scenarios and 60 audited captures; the retained gallery totals 363 PNGs. GitHub publication/CI also passed, as recorded below; local Windows Docker acceptance is not counted as passed.

| Executed check                               | Result                                                      |
| -------------------------------------------- | ----------------------------------------------------------- |
| Unit/component/API                           | 148 passed in 24 files                                      |
| Auth + transaction races                     | 15 + 3 passed                                               |
| Tenant + team + project integration          | 21 + 25 + 28 passed                                         |
| Views + planning + collaboration integration | 24 + 32 + 30 passed                                         |
| Foundation + auth browser                    | 25 + 9 passed                                               |
| Tenant + team + project + view browser       | 6 + 5 + 5 + 5 passed                                        |
| Planning + collaboration browser             | 6 + 8 passed                                                |
| Axe theme/viewport/overlay scans             | 304 earlier-phase + 60 collaboration scans, zero violations |
| Production routes/build exclusions           | 15 passed                                                   |
| Types, lint, format, production build        | Passed                                                      |
| Local Windows Compose/restart acceptance     | Deferred by the user; not executed                          |

Database/socket checks cover current identity and scope, strict Origin/CSRF inputs, guests/archives, guest owner role changes, author/version restrictions, mentions and private read flags, rollback, duplicate and concurrent retry identities, cursors/anchors/inbox paging, tombstones/deleted tasks, fresh-connection durability, passive session expiry, anonymous/foreign socket rejection, authorized subscriptions, degraded stream recovery/resynchronization, deduplicated presence, content-free committed invalidations, reconnect, expired/revoked identities and deleted parents.

Browser checks exercise two signed-in contexts, real comments/mentions/inbox flags and links, cross-session task/planning updates, preserved original drafts, stale edit reload, deletion focus restoration, guests/archive/revocation, offline recovery, unavailable/lost responses, later-page message anchors, direct refresh and reduced motion. Ten page/dialog families in both themes at375/768/1440 check overflow and axe; overlays check containment, Escape and restoration. Happy-path console/runtime errors are checked. Earlier suites are regression coverage, not replaced by these cases.

Verification fixes include stripping the project ID from parent-only repository filters, filtering current mention choices, joining only active tasks in notification reads, preserving allowlisted collaboration return links and canonical filtered-project paths without relaxing redirect guards, supporting the live request budget, closing revoked overlays, and reporting a closed stream as unavailable during recovery. The planning regression exposed cancellation of an explicit reload by a live refresh. Live invalidations now serialize and join existing requests, then refresh requests that began before the committed event; the planning dialog stays pending until the fresh result is rendered. The original-version browser regression passed after this correction. Failed diagnostic runs and test-selector/role corrections are not counted as passing verification.

Executed command families (all integration/browser suites run sequentially against their documented fixtures):

| Command                                                                                                                                                                                         | Purpose                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`                                                                                                                                        | Strict contracts, static checks, unit/component/API coverage and production artifacts                         |
| `node scripts/check-production.mjs`                                                                                                                                                             | Default lab exclusion and public/protected direct routes, including collaboration inbox and filtered projects |
| `pnpm test:auth:integration`, `pnpm test:auth:transactions`                                                                                                                                     | Authentication and real transaction races                                                                     |
| `pnpm test:tenants:integration`, `pnpm test:teams:integration`, `pnpm test:projects:integration`                                                                                                | Current tenant/resource permissions and durable work                                                          |
| `pnpm test:views:integration`, `pnpm test:planning:integration`, `pnpm test:collaboration:integration`                                                                                          | Preferences, planning and transactional/socket collaboration                                                  |
| `pnpm test:e2e`, `pnpm test:auth:e2e`, `pnpm test:tenants:e2e`, `pnpm test:teams:e2e`, `pnpm test:projects:e2e`, `pnpm test:views:e2e`, `pnpm test:planning:e2e`, `pnpm test:collaboration:e2e` | Full browser regression, real API flows, responsive themes, keyboard and axe                                  |
| `pnpm exec playwright test -c playwright.planning.config.ts -g "original planning, milestone"`                                                                                                  | Targeted verification of the reload race before the full suite                                                |
| `pnpm format:check`, `git diff --check`, `git diff --cached --check`                                                                                                                            | Formatting and publication whitespace checks                                                                  |

The publication audit scans every staged file for generated credentials, prohibited local artifacts and broken documentation/image paths without printing secrets.

## Preview, publication and remaining boundaries

Open [the local app](http://127.0.0.1:5174/app), sign in, and choose your authorized project. **Collaboration** opens the discussion/inbox; task detail opens comments. Existing project/planning/history screens update live. No synthetic project is left in your account. [Screenshot gallery](SCREENSHOTS.md).

**Phase 8 is complete and published.** The implementation is committed and pushed to the existing private repository as **`11ac996adba48bd5f9992cab3315e7c581176b34`**. Local HEAD and GitHub main matched after publication. The [GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38420224406) completed with **success** against that exact application commit. Completed logs confirm 148 tests in 24 files, four pinned Compose infrastructure checks, 178 application integration/transaction/socket checks, 69 browser scenarios and 15 production checks. All browser suites passed directly, with no failed or flaky result reported. Formatting, lint, strict types, builds, artifact preservation and service cleanup also passed.

The publication audit passed for 589 staged files, 363 screenshots and five generated development-secret values, with no prohibited artifact, exposed secret or broken local documentation/image path. The final evidence commit changes documentation only and deliberately skips a duplicate CI run; the successful application workflow above remains the verification reference. Repository visibility and local/remote main identity are checked again after that push.

Windows acceptance recovery after installing prerequisites and resolving occupied ports: `pnpm setup`, `pnpm infra:up`, `pnpm infra:check`, `pnpm test:auth:compose`, then the named-volume restart sentinel in [TESTING.md](TESTING.md). Do not count these deferred local checks as passed. No deployment, paid provisioning, provider credential or Phase 9 implementation is introduced.
