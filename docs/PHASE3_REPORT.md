# Phase 3 — implementation and verification

Date: 10 October 2026 (Asia/Kolkata). Scope: organization/workspace creation, tenant isolation, switching, and settings. [Implementation plan](PHASE3_PLAN.md).

## Delivered behavior

Verified, onboarded users can open `/app`, create private organizations, create multiple workspaces, switch organizations/workspaces, edit authorized settings, and refresh direct routes. Resource creation and memberships persist in real MongoDB transactions. The application area has a responsive sidebar/mobile drawer, dark/light/system appearance, original orbital artwork, validated dialogs, empty/loading/error/success feedback, and account navigation.

The server rechecks organization membership and explicit workspace membership with matching parents. Owners/admins administer organization settings and create workspaces; explicit membership is still required for their workspace access. Members/guests with grants can read workspace metadata but cannot administer it. Foreign or mismatched IDs receive the same 404 as absent resources. Client roles, user IDs, or owner assignments are rejected by strict input schemas.

Settings carry an integer version. Competing updates accept one writer and reject stale edits with HTTP 409. Form values retain their observed version across background query refreshes and offer an explicit reload. Transactional authority writes conflict with concurrent membership revocation. Lists page at 50 records through indexed membership joins. Identity-scoped query caches are cleared on account changes/sign-out; no local storage value grants tenant access.

Eight REST methods are documented in [API.md](API.md). Four collections and transaction/index relationships are documented in [DATABASE.md](DATABASE.md). No invitations, membership-management endpoints, ownership transfer, projects/tasks, AI, billing, Socket.IO, or deployment are introduced. No new direct dependency or paid provider was needed.

## Changed areas

- `packages/contracts/src/tenants.ts`: shared input, response, cursor, role, and version boundaries; contract tests.
- `apps/api/src/modules/tenants/{models,repository,service,controller,routes}.ts`: tenant persistence/authorization, transactions, eligibility, HTTP controllers and route wiring; API startup/application wiring.
- `apps/web/src/lib/tenants.ts`, `lib/auth.tsx`: API queries, user/resource cache scope, safe return routes, tenant request support and cache cleanup.
- `components/Tenant{Forms,Shell}.tsx`, `pages/{Organizations,Workspace}.tsx`, `workspace.css`: persistent application UI and settings; shared auth route/title/account/onboarding navigation updates.
- `tests/integration/tenants.ts`, `tests/e2e/tenants.spec.ts`, `apps/web/test/tenants.test.tsx`, `playwright.tenants.config.ts`: real database and browser verification, form/cache regressions.
- Root commands, foundation browser exclusion, Compose verification harness, production route checker, README/documentation/gallery and 36 new screenshots.
- `infra/compose.yaml`: Mongo health check accepts the observed command-line replication field; pinned images and local secrets remain unchanged.

## Verification

Tests use MongoDB **8.3.4**, a single-node isolated `orbit-test` replica set/database on 27018, Mailpit **1.27.10**, API4001, and frontend5174. These are actual local processes, separate from deferred Compose acceptance. Tenant browser users are synthetic verified fixtures inserted only in the guarded test database; they authenticate through the real API and create tenant resources through the UI. Phase 2 regression separately verifies registration/email/onboarding through real SMTP.

| Command                             | Executed result                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm typecheck`                    | Passed across all packages                                                       |
| `pnpm test`                         | **86 passed**, 14 files                                                          |
| `pnpm build`                        | Passed: shared contracts, persistent Node API, lab-disabled production frontend  |
| `node scripts/check-production.mjs` | **7 passed**, including anonymous protected organization/workspace direct routes |
| `pnpm test:tenants:integration`     | **21 passed**, real MongoDB + Supertest                                          |
| `pnpm test:tenants:e2e`             | **6 passed**, 38 axe scans with zero violations                                  |
| `pnpm test:auth:integration`        | **15 passed**, real MongoDB + captured email                                     |
| `pnpm test:auth:transactions`       | **3 passed**, real credential races/rollback                                     |

The tenant integration suite covers anonymous/unverified/incomplete identities; Origin/CSRF; strict payload/query/ID validation; owner/resource persistence; separate-tenant lists/reads/writes; workspace/organization parent substitution; regular and guest memberships without workspace grants; readonly explicit grants; admin rights; even owner access without a workspace grant; orphan grants; concurrent settings versions; actual transaction rollback on membership insertion failure; compound uniqueness; both list paginations; fresh connections; a controlled creation/revocation write-fence race; sanitized persistence failure; and mutation limits.

Browser coverage includes empty/populated organization lists, organization and workspace overviews, both settings forms, multiple spaces and organization switching, direct refresh, API-backed persistence, a second-tab version conflict, validation, modal focus trapping/restoration, mobile drawer navigation, keyboard-only creation/navigation, reduced motion, foreign/missing membership, API unavailable/retry feedback, and sign-out/protected-route recovery. Six page families are checked in both themes at 375/768/1440px without horizontal overflow. The main creation/switching scenario also asserts no unexpected browser console/runtime errors.

During development, a browser run overlapped a production rebuild and was interrupted by Vite invalidation/navigation. The trace recorded module invalidation and reconnects. The final tenant run was executed without rebuild overlap and all six tests passed. Fixture logins were made sequential after the initial arrangement exceeded the existing two-operation password-hash capacity; production limits were retained. Review also found and fixed the form version/background-refresh issue, with a component regression test.

Prior browser regression also passed: `pnpm test:auth:e2e` — **9 passed** and 32 theme/viewport axe scans; `pnpm test:e2e` — **25 passed** and 12 theme/viewport axe scans. All those scans reported zero violations. Lint passed with zero warnings, and formatting passed. The final total is **86 unit/component/API tests**, **39 integration/transaction checks**, **40 browser scenarios**, **82 theme/viewport accessibility scans**, and **7 production route/build checks**. These accessibility counts cover the documented page matrix and tenant overlays; additional earlier overlay assertions are not counted as extra matrix scans.

## Screenshots and manual review

Retained captures are listed in [SCREENSHOTS.md](SCREENSHOTS.md), including both appearances of the six new page families. Desktop dark and mobile light workspace screenshots were visually inspected. Captures show synthetic records created by real UI/API/database operations; all run-owned users/tenants are cleaned afterward.

Register and verify at `http://127.0.0.1:5174/auth/register`, inspect email at `http://127.0.0.1:18025/`, finish onboarding, then choose **Open my organizations** from the account screen. Create an organization, add two workspaces, switch via navigation, edit settings, refresh, compare two settings tabs, and try copied URLs from another account. No credentials or business data are seeded for a real user.

## Limits and infrastructure recovery

Docker/WSL remain deferred by the user. The pinned Compose MongoDB **8.0.17**, Redis, Garage, full service acceptance, and container restart durability were not verified locally. Readiness remains HTTP 503 while Redis is absent. Fresh-connection persistence is verified and must not be described as container-restart verification.

The initial published GitHub run [38063722626](https://github.com/devanshchaudharyy/orbit/actions/runs/38063722626) failed at `pnpm infra:up`: Mongo was unhealthy. Live `getCmdLineOpts` on the isolated fixture returned `replication.replSet`, while the previous command accepted only `replSetName`. The command now supports both. This is a concrete correction, not a claim that Docker acceptance passed. The next pushed workflow result is separate from the local results above.

After installing the documented prerequisites, stop the owned isolated fixture, resolve occupied Compose ports, then run:

```powershell
pnpm infra:up
pnpm infra:check
pnpm test:auth:compose
```

Follow the sentinel restart check in [TESTING.md](TESTING.md), then record actual results. The extended Compose harness runs both account and tenant integration/browser checks; it has not been executed locally.

## Preparation for Phase 4

Organization/workspace IDs, explicit authority records, unique membership indexes, owner/admin policy checks, transaction fences, and persistent UI scope are available. Phase 4 implements invitation acceptance/revocation, membership lifecycle, roles and permission management, and safe ownership transfer. It must preserve tenant/parent checks, explicit workspace grants, invariants, and authority fence writes. Stop after Phase 3.
