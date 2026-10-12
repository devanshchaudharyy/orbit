# Phase 6 — work views and personal preferences

Date: 11 October 2026. Scope: list, Kanban, table, calendar, status/date moves, private saved filters and preferences. [Plan](PHASE6_PLAN.md). Implementation, local verification, private publication and remote CI are complete. Stop after Phase 6.

## Implemented behavior

Four views share one authorized task endpoint and validated common filters. List/table group by status or priority. Server sorting supports oldest/newest, title, priority, due date and status, with ID tie breaks and pages of fifty. Actual total matches and partial loading are visible. Calendar queries inclusive UTC month boundaries, supports Monday/Sunday week starts and keeps undated work separate. Adjacent days are scheduling targets; work outside the selected month is not loaded into the current collection. Wide boards/tables/calendars use contained, labeled, keyboard-focusable scrolling regions.

Kanban handles move tasks between statuses; calendar handles schedule dates or clear them in the undated drop area. Equivalent Move dialogs support keyboard/touch. Original versions reject conflicts. The endpoint changes only supplied status/date fields, preserving assignments, descriptions and checklists; activity commits transactionally. No-op moves create no version or activity event. Ordering follows the selected server sort; manual ordering within columns is outside this phase.

MongoDB stores personal per-user/project defaults and at most twenty private named filters. Preferences persist view, sort/group, density, week start, optional table columns and subtask visibility across sessions. Named filters contain view/sort/group and common filters; month and visual preferences remain separate. Explicit URL choices override saved defaults. Saving is explicit and versioned. Every request rechecks verified identity and current organization/workspace/project access. Guests may edit personal settings while remaining read-only for task moves. Archived projects preserve settings; deleted/inaccessible projects protect retained records.

Added strict shared contracts; separate backend models/repository/service/controller/routes; private compound indexes and a calendar task index; frontend hooks, components, styles and validated dialogs. Exact `@dnd-kit/react` **0.5.0** was added after checking React 19 peers and the [official quick start](https://dndkit.com/react/quickstart/). Resource changes remount local project state. Keyset pagination describes current records, not an immutable snapshot across concurrent edits; missing/filtered-out anchors return a conflict requiring reload. No infrastructure/provider was provisioned.

## Executed local verification

The owned fixture reports MongoDB **8.3.4**, replica set `orbit-test`, database `orbit_test_phase2`, and Mailpit **1.27.10** reachable. API 4001/frontend 5174 are separate from the foundation preview. Tests use unique synthetic records and clean their artifacts. These results do not verify the deferred Windows Docker stack.

| Command                                 | Observed result                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm auth:fixture status`              | MongoDB, Mailpit, API and frontend reachable                                           |
| `pnpm typecheck`                        | All packages passed after final source fixes                                           |
| `pnpm lint`                             | Passed, zero warnings                                                                  |
| `pnpm test`                             | **121 passed**, 20 files                                                               |
| `pnpm build`                            | Contracts, API and production frontend passed                                          |
| `node scripts/check-production.mjs`     | **12 passed**, including lab gating/direct refresh                                     |
| `pnpm test:views:integration`           | **24 passed**                                                                          |
| `pnpm test:projects:integration`        | **28 passed**                                                                          |
| `pnpm test:auth:integration`            | **15 passed**, real SMTP capture                                                       |
| `pnpm test:auth:transactions`           | **3 passed**                                                                           |
| `pnpm test:tenants:integration`         | **21 passed**                                                                          |
| `pnpm test:teams:integration`           | **25 passed**                                                                          |
| `pnpm test:views:e2e`                   | **5 passed**, 54 axe scans, zero violations                                            |
| `pnpm test:projects:e2e`                | **5 passed**, 54 axe scans, zero violations                                            |
| `pnpm test:e2e`                         | **25 passed**, 12 axe scans, zero violations                                           |
| `pnpm test:auth:e2e`                    | **9 passed**, 32 axe scans, zero violations                                            |
| `pnpm test:tenants:e2e`                 | **6 passed**, 38 axe scans, zero violations                                            |
| `pnpm test:teams:e2e`                   | **5 passed**, 48 axe scans, zero violations                                            |
| `pnpm format:check`, `git diff --check` | Passed after final documentation updates                                               |
| Staged publication audit                | **425 files**, **237 PNGs**, five generated secrets and local links checked; no issues |

Totals: **121 unit/component/API tests**, **116 real integration/transaction checks**, **55 browser scenarios**, **238 axe scans with zero violations**, and **12 production checks**. Failed attempts and diagnostic repetitions are not counted as passes/additional scenarios. Every final browser suite passed directly without retries.

The 24 new database checks cover identity/CSRF/strict validation, private scope, optimistic races, twenty-filter concurrency, guest/archive/revocation rules, move preservation/no-op/rollback, UTC bounds, undated work, all six sort orders across pages, totals, missing anchors, subtasks, fresh-connection persistence and deleted-project access. Both API responses and stored records are asserted.

The five new browser scenarios exercise real views/task/settings flows, pointer moves and cancellation, keyboard/touch dialogs, private filters, defaults in a fresh browser session, explicit URL overrides, direct refresh, stale records, guest/revoked access, archives, service failures/recovery and 61 tasks across pages. Happy flows assert no console/runtime errors. Intentional API failures render truthful feedback and preserve edits. Nine page/dialog families in dark/light at **375, 768 and 1440px** produce **54 accessibility scans and screenshots**, with page overflow, keyboard navigation, focus trapping/restoration and reduced-motion checks.

| Flow boundary      | Executed evidence                                                    |
| ------------------ | -------------------------------------------------------------------- |
| Browser → client   | Real tabs, filters, drag handles and validated dialogs               |
| Client → API       | Scoped queries, CSRF mutations, original versions and explicit retry |
| API → MongoDB      | Current access, private indexes, transactions and rollback           |
| MongoDB → response | DTO/schema checks, empty criteria round-trip, totals and pages       |
| Response → browser | Updated status/date/groups, conflict reload and restored focus       |

Verification corrected implicit select labels, MongoDB minimizing empty filter criteria, invalid mock request IDs, and focus restoration when a moved task disappears. Empty filters are now preserved, with a DTO fallback for legacy rows. Focus restoration waits for refresh and falls back to the active view tab when its trigger disappears. Each has regression coverage. The older tenant integration harness clears only its defined loopback request buckets in the explicitly named test database between scenarios; production rate limits are unchanged. The prior execution-approval usage limit is resolved and no longer blocks verification.

## Screenshots and publication

The [gallery](SCREENSHOTS.md) retains **54 new Phase 6 screenshots**, bringing the retained gallery to **237 PNGs**. Historical captures remain distinguishable. Desktop list/board, mobile calendar, mobile preference-dialog and tablet light-table captures were visually inspected in addition to the automated matrix. README includes real Kanban/calendar screenshots.

Private repository: [devanshchaudharyy/orbit](https://github.com/devanshchaudharyy/orbit). Code, tests, README, documentation and screenshots were committed with `git commit -m "feat: add Phase 6 work views and personal preferences"` and pushed using `git push origin main`. The verified application commit is **`8d089da35e3caab20c78110943b30eca2a3514bc`**.

The [Phase 6 GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38150192862) **completed successfully** for that commit. Frozen installation, generated local configuration, formatting, lint, strict types, 121 tests in 20 files, builds, 12 production checks, evidence upload and service cleanup passed. The completed log confirms all four infrastructure checks: MongoDB transaction commit/rollback and reconnect persistence, Redis round-trip/reconnect persistence, private S3 upload/download/deletion and SMTP capture. These use pinned Compose MongoDB **8.0.17**, Redis **8.2.2-alpine**, Garage **2.4.1** and Mailpit **1.27.10**.

The Compose harness passed all **116 application integration/transaction checks** and account/tenant/team/project/view browser suites. Together with the foundation suite, the completed remote log reports **25 + 9 + 6 + 5 + 5 + 5 = 55 browser scenarios passed directly**, with no flaky outcome reported. Successful matrix assertions cover the 238 axe scans. New view results include all 24 database checks and all five browser scenarios. The isolated Playwright config and Compose harness keep the Phase 6 suites separate from earlier regressions.

The final evidence update changes documentation only and uses `[skip ci]`; application code/tests remain at the verified commit above. The publication audit checked 425 staged files, 237 PNGs, five generated credential values, excluded local artifacts and local links without issues. Development configuration, fixture executables/databases, local reports and downloaded diagnostics remain ignored. Final local `/app` and API liveness returned HTTP 200, with a request ID in the API envelope.

## Preview, limits and recovery

[ORBIT app](http://127.0.0.1:5174/app): sign in, finish email verification/personal onboarding, create/open an authorized organization/workspace/project and choose a view. No synthetic records are seeded into user accounts. [Captured local email](http://127.0.0.1:18025/) supports the owned fixture.

Docker/WSL installation remains deferred by the user. Windows Redis/Garage and container-restart durability are unverified. Mongo-backed views function while aggregate readiness is HTTP 503 without Redis. Fresh-connection persistence is not a restart check. The completed remote Compose workflow is separate from the unexecuted Windows restart sentinel. After installing the documented Windows prerequisites and resolving occupied ports:

```powershell
pnpm setup
pnpm infra:up
pnpm infra:check
pnpm test:auth:compose
```

Then run the manual restart sentinel in [TESTING.md](TESTING.md), preserving named volumes. The Compose harness includes account, tenant, team, project and view integration/browser suites.

Phase 7 timeline/Gantt, dependencies, milestones, sprints and workload remain unimplemented. Realtime/comments, files/rich text, analytics, AI/automation and billing retain their later phase boundaries. No deployment, paid service, provider account or business-data seed was introduced.
