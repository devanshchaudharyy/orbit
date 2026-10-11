# Phase 5 implementation and verification

Date: 11 October 2026, Asia/Kolkata. Scope: projects, tasks/subtasks, assignments, filtering, labels and activity history. [Plan](PHASE5_PLAN.md). Implementation, local regression verification and GitHub verification are complete. Exact results and publication evidence follow below. Local Docker/WSL installation remains deferred at the user's request.

## Delivered behavior

- Real workspace-scoped project creation/settings, status and priority, original vector covers, owner/team and explicit guest grants. Blank and launch-checklist templates create editable records. Archive/restore preserves work; deletion atomically soft-deletes project tasks and subtasks.
- Tasks and one-level subtasks with descriptions, status, priority, validated UTC calendar due dates, owner, up to ten collaborators, project labels and up to twenty checklist items. Parent deletion removes its subtasks from active work. Progress counts active tasks and subtasks, including completed children independently.
- Project search/status/archive filters and task search/status/priority/assignee/label/overdue filters combine on the server and persist in the URL across refresh. Search escapes regular-expression syntax. All lists have stable cursors and pages of at most fifty records.
- Activity persists in the same transaction as each mutation, including status transitions, templates, grants/settings, labels and lifecycle. Current resource access protects history; historical names and references never grant authority. This is project history, not the future organization audit log.
- Workspace membership is always explicit. Owners/admins/project managers with that grant manage workspace projects. Eligible project owners manage their project; only workspace managers can transfer its owner. Other members need project grants and can manage tasks. Explicitly granted guests remain read-only. Owners and assignments require current eligible access; revocation takes effect without clearing historical task references.
- Original responsive directory and project/task detail, accessible dialogs/sheets, paginated current teammate choices, checklists, labels, confirmations, loading/empty/error/unavailable/success states and stale-editor recovery. Query keys include identity and all parents. Editors keep their original version; resource navigation remounts local editor state.

## Files, APIs and data

Added `packages/contracts/src/projects.ts`, `apps/api/src/modules/projects/{models,repository,service,controller,routes}.ts`, `apps/web/src/{lib/projects.ts,components/ProjectForms.tsx,pages/Projects.tsx,projects.css}`, contract/component tests, `tests/integration/projects.ts`, `tests/e2e/projects.spec.ts` and `playwright.projects.config.ts`. Extended API startup, guards/navigation/return destinations, workspace/team copy, production checks, Compose verification, CI timeout and documentation. No new dependency or provider provisioning; lockfile unchanged.

New `projects`, `tasks`, `project_events` collections include verified organization/workspace parents; task/event queries include the project. Compound indexes support scoped pages, memberships, parents/assignees and activity order. Optimistic versions prevent overwritten edits. Mutations fence current organization/workspace authority and the project; retries recheck access. Grant/assignment validation fences target memberships. Exact endpoints, indexes and policy are in [API.md](API.md), [DATABASE.md](DATABASE.md), and [ARCHITECTURE.md](ARCHITECTURE.md).

## Executed local verification

Fixture: MongoDB **8.3.4**, replica set `orbit-test`, isolated `orbit_test_phase2` database on 27018; Mailpit **1.27.10**, SMTP11025/HTTP18025; API4001/frontend5174. Tests create unique synthetic users/tenants and clean only their IDs. No business records are seeded into a real user account. The fixture is independent of pinned Docker Compose.

| Exact command                                                           | Result                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm auth:fixture status`                                              | MongoDB, API, frontend and Mailpit reachable                                                       |
| `pnpm lint`                                                             | Passed, zero warnings                                                                              |
| `pnpm -r typecheck` after contracts build                               | Passed, every package                                                                              |
| `pnpm test`                                                             | **107 passed**, 18 files                                                                           |
| `pnpm build`                                                            | Contracts, Node API and default production frontend passed                                         |
| `node scripts/check-production.mjs`                                     | **12 passed**, including project/task guards, refresh return destinations and lab exclusion        |
| `pnpm --filter @orbit/api exec tsx ../../tests/integration/projects.ts` | **28 passed**, real MongoDB/Supertest transactions                                                 |
| `pnpm test:projects:e2e`                                                | **5 passed**, real API/database; **54 axe scans**, zero violations                                 |
| `pnpm test:auth:integration` / `pnpm test:auth:transactions`            | **15 / 3 passed**, real account/email and transaction checks                                       |
| `pnpm test:tenants:integration` / `pnpm test:teams:integration`         | **21 / 25 passed**, real MongoDB permissions, races and persistence                                |
| `pnpm test:auth:e2e` / `pnpm test:tenants:e2e` / `pnpm test:teams:e2e`  | **9 / 6 / 5 passed**, **32 / 38 / 48** axe scans with zero violations                              |
| `pnpm test:e2e`                                                         | **25 passed** on the final full rerun; **12** axe scans with zero violations                       |
| `pnpm format:check`                                                     | Passed                                                                                             |
| Staged links/images/secrets audit                                       | Passed: 352 tracked/staged files, 183 screenshots, five generated secret values checked; no issues |
| Local Compose and container-restart sentinel                            | Not executed; Docker/WSL deferred                                                                  |

Final local totals: **107 unit/component/API tests**, **92 real integration/transaction checks**, **50 browser scenarios**, **184 documented axe scans with zero violations**, and **12 production checks** passed. These totals include prior-phase regressions; failed/interrupted attempts are excluded.

The 28 project integration checks cover identity eligibility, Origin/CSRF/strict input, errors/request IDs/no-store, foreign parents/resources/history, explicit admin workspace grants, manager authority, guest read-only behavior, member task rights, eligible owners/grants/assignments, labels, status/checklists/history/progress, stale/concurrent edits, subtask restrictions, combined filters, archive/restore, label cleanup, activity-failure rollback, templates, grant revocation, project-owner limits, cascades, all four paginated APIs, retry-time membership revalidation and fresh-connection persistence.

Browser verification walks creation → API → actual database → rendered records. It covers editing, multiple collaborators/owner, checklist, subtask/parent navigation, labels, combined filters retained on refresh, status history, actual progress, two-tab stale edits and reload, guest/membership denial on direct refresh, unavailability/retry, no-match states, templates, archive/restore and cascades. Both themes run at **375px, 768px and 1440px**; checks cover overflow, happy-flow console/runtime errors, reduced motion, Tab containment, Escape and restored focus. Production guards protect directory/project/task deep links.

## Issues found and fixed

The initial long task sheet had no internal scrolling, leaving checklist controls unreachable below the viewport. Dialogs now have bounded viewport height and vertical scrolling; final flow and keyboard/axe checks pass. Exact-label filtering exposed an implicit nested-select label association; filters now use explicit label/id pairs. Errors announce actual failures. Resource-route keys keep open editor state from carrying into another project. A prior tenant browser assertion queried by display name and could select another same-named organization; it now uses the exact created ObjectId. Application queries already use scoped identifiers. One foundation regression run showed a blank page while opening mobile navigation (24 passed, 1 failed); the isolated navigation check subsequently passed. Its cause was not established; the final full-suite rerun is recorded separately. Initial failing/interrupted runs are not counted as passes.

## Screenshots and manual review

Retained **54 new captures**: empty/populated directory, create-project dialog, empty/populated/filtered/archived project, task detail and edit sheet, each in both themes at three widths. [Gallery](SCREENSHOTS.md). Dark desktop project and light mobile task captures were visually inspected for hierarchy, wrapping, contrast, spacing and controls.

Preview: [local application](http://127.0.0.1:5174/app). Complete personal verification/onboarding, open an explicitly granted workspace, then **Projects**. Create a project, choose its owner and team, add a label/task/checklist/subtask, change status, filter, refresh, and inspect history. Two tabs demonstrate stale-edit recovery. Invitees obtain workspace access through **Team & access**; project grants are separate. Synthetic test records are cleaned up, so users see their own actual data.

## GitHub and final regression evidence

Implementation commit `4b58bc62e622cf8791279b47345e3ce0b1737fed` was pushed to private [devanshchaudharyy/orbit](https://github.com/devanshchaudharyy/orbit); local and GitHub `main` matched. The [initial Phase 5 workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38114359074) completed successfully, including frozen installation, formatting, lint, strict types, unit tests, production builds/checks, pinned Compose startup, four infrastructure checks, foundation browser checks and the full Compose account/tenant/team/project suite. Evidence upload and service cleanup also passed.

The completed log reported one project browser scenario as flaky (four passed directly, one passed on retry). Downloaded browser evidence identified a test route-capture race: after creation the helper matched the project's directory-card heading before detail navigation completed, then signed the member into that directory URL and incorrectly expected a detail-only Create task button. The application rendered the directory correctly. Helpers now wait for canonical organization/workspace/project/task detail URLs and level-one headings before capturing identifiers. This is an explicit observable-state wait, not a delay or relaxed permission assertion.

After that correction, `pnpm exec playwright test -c playwright.projects.config.ts --grep 'members need explicit' --repeat-each=3 --retries=0` passed **three consecutive retry-free repetitions**. The full `pnpm test:projects:e2e` then passed **all five scenarios** and the 54 axe scans again. Lint and formatting passed. These additional repetitions are not added to the 50 distinct-scenario total.

The [corrective Phase 5 workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38115337823) **completed successfully** for `740bfb08405c49290739a3deeae419384d59c5f0`. Its completed log confirms 107 tests in 18 files, all four infrastructure checks, 12 production checks, 25 foundation browser scenarios, nine account scenarios, six tenant scenarios, five team scenarios and **five project scenarios passed directly**. No flaky outcome was reported. The Compose harness also completed all 92 account/tenant/team/project integration and transaction checks. Frozen installation, formatting, lint, strict types, builds, evidence upload and service cleanup passed. This remote verification uses the pinned Compose environment and remains separate from the deferred Windows restart sentinel.

The final documentation-only evidence update is committed with `[skip ci]`; application code and browser tests remain at the verified commit above. Development configuration, fixture executables/databases, downloaded CI evidence and local test reports remain ignored. The publication audit checked 352 files, 183 screenshots, five generated secret values and local links with no issues. Final local API liveness and the `/app` preview both returned HTTP 200; liveness included a request ID.

## Limits, recovery and next phase

Local Redis/Garage and Docker Compose are unverified in this phase. Mongo-backed project work functions while aggregate readiness remains 503 without Redis. Fresh-connection persistence is not container-restart durability. After installing the documented Windows prerequisites and resolving occupied ports:

```powershell
pnpm setup
pnpm infra:up
pnpm infra:check
pnpm test:auth:compose
```

Then execute the manual sentinel in [TESTING.md](TESTING.md), preserving named volumes. The Compose harness includes account, tenant, team and project integration/browser suites.

Covers use built-in original vectors; image upload belongs to Phase 9. Basic task collections/filters are implemented; advanced views/drag-and-drop/preferences are Phase 6, milestones/sprints/dependencies Phase 7, realtime/comments Phase 8, files/rich text Phase 9, analytics Phase 10, AI/automation Phase 11, billing Phase 12 and global search/audit/integrations Phase 13. Recurring tasks, custom fields, bulk operations and task templates remain unimplemented without decorative controls. Soft-deleted records are retained without a public restore/purge endpoint; retention/restore policy needs future design. Activity retains historical names and references while current membership determines access.

Phase 6 is not started. Scoped contracts, filters, stable IDs, optimistic versions and transaction fences prepare advanced views. Stop after Phase 5.
