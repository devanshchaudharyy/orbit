# Phase 7 — delivery planning

Date: 12 October 2026. Scope: milestones, sprints/board, timeline/Gantt, dependencies, workload planning and delivery tracking. [Plan](PHASE7_PLAN.md). Stop after Phase 7.

## Implemented behavior

Five URL-addressable project tabs expose actual persisted planning. Milestones pair an explicit open/delivered status with actual linked-task progress; marking delivery never changes task status. Sprints move from planned to active to completed, allow only one active sprint per project, freeze commitment at start and delivery at completion, and carry unfinished tasks to explicit backlog or a planned sprint. Completed history is immutable; later task status changes do not rewrite snapshots. Planned-sprint deletion and milestone deletion detach metadata without destroying tasks.

Planning metadata stores entered start/estimate, milestone/sprint links and finish-to-start prerequisites separately from task content. Saves check both original plan and task versions, update due dates transactionally when needed and preserve descriptions, labels, assignments and checklists. Existing task editors/status-date moves also guard the stored start/due invariant. Self/duplicate/foreign/cyclic edges are rejected, including simultaneous opposite-edge writes. Unresolved prerequisites and scheduling conflicts are advisory, with no silent date/status changes. Deleted prerequisite IDs remain labeled `Removed prerequisite`, without deleted-title leakage.

The original HTML/CSS/SVG Gantt uses actual UTC dates, labeled contained scrolling, decorative connectors for loaded edges and equivalent text. Unscheduled/out-of-window tasks remain available. Sprint boards reuse actual task status moves with pointer handles and keyboard/touch dialogs. Forecast excludes done work, splits entered effort across assignees and scheduled calendar days, and follows task filters across all pages. Capacity uses explicitly entered weekly hours × weekdays / 5. Unknown effort, unscheduled and unassigned work remain explicit; no fabricated capacity, actual hours, velocity or burndown.

Current verified/onboarded identity plus organization/workspace/project access precedes every operation. Managers/project owners manage resources/capacity; non-guest collaborators plan tasks; guests read only. Archives reject writes; revocation/deletion denies private access. Project/membership fences serialize mutations and append activity in the same transaction. Conflicts retain original drafts and require explicit reload; unavailable writes retain drafts and require explicit resubmission. Focus returns after refresh to the initiating control or active tab when the control disappears.

Task rows paginate at 100 with full matching totals and six server sorts. Live cursors are not immutable across edits; invalidated anchors require reload. Milestones/sprints each have a transactional fifty-record bound, active project graphs at most 5,000 tasks and UTC windows at most 90 days. Over-limit requests return explicit errors. Global delivery/milestone/sprint summaries remain project-wide, while workload follows filters. No new dependency, provider or infrastructure service was introduced.

Added shared contracts/helpers; separate API models/repository/service/controller/routes; four indexed collections; browser hooks/forms/views/styles; contract/component/integration/browser checks; Compose CI coverage and current documentation. Phase 8 realtime/comments/notifications and subsequent files, analytics, AI, automation and billing remain unimplemented.

## Verification and evidence

The owned fixture uses MongoDB **8.3.4**, replica set `orbit-test`, database `orbit_test_phase2`, Mailpit **1.27.10**, API4001 and frontend5174. Unique synthetic test records are cleaned by their IDs and never seeded into user accounts. Local fixture results are separate from Windows Docker acceptance.

| Executed command                    | Result                                                          |
| ----------------------------------- | --------------------------------------------------------------- |
| `pnpm typecheck`                    | All packages passed                                             |
| `pnpm lint`                         | Passed, zero warnings                                           |
| `pnpm test`                         | **136 passed**, 22 files                                        |
| `pnpm build`                        | Contracts, API and production frontend passed                   |
| `node scripts/check-production.mjs` | **12 passed**, including protected direct routes and lab gating |
| `pnpm test:planning:integration`    | **32 passed**                                                   |
| `pnpm test:projects:integration`    | **28 passed**                                                   |
| `pnpm test:views:integration`       | **24 passed**                                                   |
| `pnpm test:auth:integration`        | **15 passed**, actual SMTP capture                              |
| `pnpm test:auth:transactions`       | **3 passed**                                                    |
| `pnpm test:tenants:integration`     | **21 passed**                                                   |
| `pnpm test:teams:integration`       | **25 passed**                                                   |
| `pnpm test:e2e`                     | **25 passed**, 12 axe scans                                     |
| `pnpm test:auth:e2e`                | **9 passed**, 32 axe scans                                      |
| `pnpm test:tenants:e2e`             | **6 passed**, 38 axe scans                                      |
| `pnpm test:teams:e2e`               | **5 passed**, 48 axe scans                                      |
| `pnpm test:projects:e2e`            | **5 passed**, 54 axe scans                                      |
| `pnpm test:views:e2e`               | **5 passed**, 54 axe scans                                      |
| `pnpm test:planning:e2e`            | **6 passed**, 66 axe scans                                      |

Totals: **136 unit/component/API tests**, **148 real integration/transaction checks**, **61 browser scenarios**, **304 axe scans with zero violations**, and **12 production checks**. Earlier browser suites were rerun during Phase 7 regression; the final planning suite passed after the last URL update fix. Every final browser suite passed directly without retries. Diagnostic repetitions and failed attempts are not counted as additional passing scenarios. Formatting and staged audits are checked after documentation updates.

The six planning browser scenarios cover actual create/plan/dependency/milestone/capacity/sprint/move/complete flows, stale original versions, cyclic edges, disappearing-trigger focus, read-only guests, revocation, archives, unavailable API feedback/retry, invalid windows and 105 filtered tasks across pages. Eleven page/dialog families in dark/light at 375/768/1440 produce 66 axe scans and captures, with overflow, keyboard containment/restoration, direct refresh, reduced motion and happy-flow console/runtime checks.

| Boundary           | Evidence                                                                                |
| ------------------ | --------------------------------------------------------------------------------------- |
| Browser → client   | URL tabs/filters, original dialog snapshots, pointer and keyboard moves                 |
| Client → API       | Scoped health/session/resource requests, CSRF, strict inputs, explicit retry            |
| API → MongoDB      | Current access, transactional graph/lifecycle/membership fences and rollback            |
| MongoDB → response | Existing task DTO preservation, filtered forecast, actual totals, frozen delivery       |
| Response → browser | Visible schedules/progress, preserved failed drafts, refreshed state and restored focus |

The planning database suite covers anonymous/unverified/incomplete identities, parent substitution and missing workspace access; resource-management restrictions and guest reads; unique names and transactional count limits; both original versions; cross-module date guards; self/duplicate/foreign/cyclic dependencies and opposite-edge races; activity rollback; nullable/entered capacity, weekday scaling, shared estimates and filtered forecast; commitment, one-active-sprint races, completion/carryover/replay, frozen history and explicit milestone delivery; invalid carry targets, detachment/deleted prerequisites, full totals/sorts/pages/missing cursors, oversized graphs, fresh-connection persistence, archives, revocation and deleted projects.

Corrections found during verification include stable explicit labels for prefilled textarea values, one success announcement, separately selectable error feedback, valid canonical account return links, original invalid-window URL construction, filtered workload forecasts and synchronized window fields after recovery. Visual review corrected count/date spacing. Rapid filter changes now merge the latest browser URL so search and sort remain combined while a concurrent router render is pending; browser assertions cover the retained input/URL and paginated result. These retain production authorization and original-version protections. A fixture-status command rebuilding contracts interrupted one development browser run; final browser verification keeps build commands idle. Failed diagnostic attempts are not counted as passing scenarios.

## Publication and preview

The [gallery](SCREENSHOTS.md) retains **66 new Phase 7 captures**, bringing the retained gallery to **303 PNGs**. Desktop dark Gantt, mobile light workload, tablet light task-plan dialog and mobile dark completion dialog were visually inspected in addition to the automated matrix. README includes real timeline/workload captures. Final local `/app` and liveness return HTTP 200 with a request ID in the API envelope; aggregate readiness remains HTTP 503 without Redis. The fixture-status check confirms MongoDB/API/frontend/Mailpit are reachable. The Docker executable remains unavailable; full Windows infrastructure/restart checks were not rerun.

Code, tests, README, docs and successful screenshot captures are prepared for the existing private [devanshchaudharyy/orbit repository](https://github.com/devanshchaudharyy/orbit). Final commit and exact CI evidence are recorded here after execution.

[Local ORBIT app](http://127.0.0.1:5174/app): sign in, verify email, finish personal onboarding, create/open an authorized organization/workspace/project and choose **Delivery planning**. [Captured local email](http://127.0.0.1:18025/) supports the fixture.

Docker/WSL and Windows Redis/Garage/container-restart acceptance remain deferred by the user. Mongo-backed planning works while aggregate readiness reports 503 without Redis. Fresh-connection persistence is separate from restart durability. Remote Compose results do not replace Windows restart acceptance. After installing documented prerequisites and resolving occupied ports:

```powershell
pnpm setup
pnpm infra:up
pnpm infra:check
pnpm test:auth:compose
```

Then execute the manual restart sentinel in [TESTING.md](TESTING.md), preserving named volumes. The Compose harness includes all application phases through planning. No deployment, paid service, provider account or business-data seed was introduced. Stop after Phase 7.
