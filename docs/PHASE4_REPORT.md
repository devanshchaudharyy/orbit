# Phase 4 implementation and verification

Date: 10 October 2026, Asia/Kolkata. Scope: invitations, membership lifecycle, roles, explicit workspace permissions and safe ownership transfer. [Plan](PHASE4_PLAN.md). Implementation and independent local verification are complete. Full local Docker acceptance is deferred at the user's request.

## Delivered behavior

- Actual SMTP invitations with random 256-bit credentials, SHA-256 hashes, normalized recipient email, seven-day expiry and explicit workspace grants. Pending list, revoke, single-use acceptance, wrong-account feedback and duplicate-member protection.
- Owner/admin/project-manager/member/guest roles. Owners alone manage admin privileges and ownership. Admins manage lower roles. Non-admins see their access explanation and leave action without fetching the private roster. Organization administration never implies workspace content access.
- Transactional role/grant replacement, immediate grant denial, member removal, leaving, and invalidation of affected pending links. Separate member versions reject stale edits; organization and membership write fences coordinate concurrent authority changes.
- Ownership transfer to an existing verified/onboarded member after current-password verification. Exactly one owner and a consistent owner pointer; the former owner becomes admin. Grants remain explicit. Credential fencing prevents a password change from racing a transfer verified against an old hash.
- Responsive original team roster, pending/empty/loading/error/success states, invitation dialog, access sheet, confirmations, password visibility, focus containment/restoration, both themes and reduced motion. Real API responses drive every account/team record.
- New invitees can register, verify by captured email and complete their profile before returning to acceptance. Credentials remain in tab memory across SPA navigation; opening a link while already on the acceptance route also works. Fragments are scrubbed; no raw token enters browser storage or response DTOs. Refresh requires reopening the email.
- Lazy browser routes, identity/tenant-scoped TanStack Query, API/controller/service/persistence boundaries, strict shared contracts, indexes, persistent abuse budgets, Compose CI coverage, documentation and screenshots. No new dependency, deployment, paid service, or production record seed.

## Files and APIs

Added `apps/api/src/modules/teams/{routes,service,repository,mail}.ts`, `packages/contracts/src/teams.ts`, `apps/web/src/{pages/Team.tsx,pages/Invitation.tsx,lib/teams.ts,team.css}`, contract/component tests, real integration/browser drivers and `playwright.teams.config.ts`. Extended tenant model versions/roles/fences, API startup/router wiring, account return destinations, navigation and future-feature copy. Existing HTTP safeguards and database adapters are reused.

New `team_invitations` collection; membership version/project-manager enum; organization teamRevision. The API includes private team/pending-invitation lists, create/revoke/accept invitations, change/remove members, leave and ownership transfer. Exact paths, inputs and statuses are in [API.md](API.md); transaction/index/retention details are in [DATABASE.md](DATABASE.md).

## Executed verification

Real fixture: MongoDB **8.3.4**, replica set `orbit-test`, isolated `orbit_test_phase2` database on 27018; Mailpit **1.27.10**, SMTP11025 / HTTP18025; API4001; frontend5174. Test accounts/tenants/messages are unique synthetic artifacts and cleanup targets only their own IDs. Docker Compose's pinned Mongo8.0.17 is a separate environment.

| Command                                                                               | Final executed result                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm auth:fixture status`                                                            | MongoDB, API, frontend and Mailpit reachable                                                                                                                  |
| `pnpm lint`                                                                           | Passed, zero warnings                                                                                                                                         |
| `pnpm format:check`                                                                   | Passed                                                                                                                                                        |
| `pnpm typecheck`                                                                      | Passed, all packages                                                                                                                                          |
| `pnpm test`                                                                           | **96 passed**, 16 files                                                                                                                                       |
| `pnpm build`                                                                          | Contracts, Node API and default production frontend passed                                                                                                    |
| `$env:CI='true'; $env:FORCE_COLOR='1'; node scripts/check-production.mjs`             | **9 passed**; marketing, lab exclusion, account refresh/reset safety, protected app/team/workspace routes, incomplete invitation refresh, lab content omitted |
| `pnpm test:teams:integration`                                                         | **25 passed**, real MongoDB/Supertest; controlled mail adapter for failure/retry injection                                                                    |
| `pnpm test:teams:e2e`                                                                 | **5 passed**, real API, MongoDB and SMTP; **48** page/overlay axe scans, zero violations                                                                      |
| `pnpm test:tenants:integration`                                                       | **21 passed**, prior tenant regressions                                                                                                                       |
| `pnpm test:auth:integration`                                                          | **15 passed**, real account/database/email regressions                                                                                                        |
| `pnpm test:auth:transactions`                                                         | **3 passed**, real credential transaction races                                                                                                               |
| `pnpm test:tenants:e2e`                                                               | **6 passed**, **38** page/overlay axe scans, zero violations                                                                                                  |
| `pnpm test:auth:e2e`                                                                  | **9 passed**, **32** axe scans, zero violations                                                                                                               |
| `pnpm test:e2e`                                                                       | **25 passed**, marketing/lab regressions; **12** theme/viewport axe scans, zero violations                                                                    |
| `git diff --check`, documentation link/image and staged-file audit                    | Passed; excluded generated secrets, local data, executable binaries and test reports                                                                          |
| Local `pnpm infra:up`, `pnpm infra:check`, `pnpm test:auth:compose`, restart sentinel | Not executed in Phase 4; Docker/WSL remain deferred                                                                                                           |

Totals are **96 unit/component/API tests**, **64 real integration/transaction checks**, **45 browser scenarios**, and **130 documented theme/viewport/overlay axe scans**, plus **9** production build/route checks. Unit/component mocks test client boundaries; they do not count as real persistence or SMTP verification.

Team integration covers anonymous/unverified/incomplete identities, Origin/CSRF, strict authority input, foreign tenants/workspaces, hashed token/expiry, duplicate pending links, intended recipient, acceptance/replay races, admin hierarchy, no implicit admin workspace access, project-manager restrictions, grant removal, stale editors, owner grant edits, SMTP rollback, automatic transaction retry sending once, expiration/revocation, issuer demotion, controlled acceptance rollback, member removal, password/stale/owner-leave denial, atomic/concurrent ownership transfer, transfer rollback, revoke-versus-accept, leave, pagination and fresh-connection persistence.

Browser flows cover existing and brand-new recipients, real mail capture, deliberate acceptance, registration/verification/onboarding continuity, protected direct-route refresh, role/grant changes, two-tab version conflicts, removal/reinvitation, current-password transfer, former-owner leave, revoked-link denial, truthful availability recovery and sign-out. Both themes run at **375px, 768px and 1440px**. The page audit records horizontal overflow and console/runtime errors; overlay audit checks Tab containment, Escape and focus restoration with reduced motion.

## Issues found and fixed

An invitation fragment opened on the already-mounted acceptance route initially failed to load; token selection now derives from current route hash with tab-memory fallback. Unit and browser coverage exercise it. A primary button briefly lost contrast during theme changes because its background interpolated while text changed immediately; its theme colors now change together. Contrast/screenshot checks wait for finite overlay animations to finish. Initial failing runs are not counted as passing results.

The previous [Phase 3 GitHub workflow](https://github.com/devanshchaudharyy/orbit/actions/runs/38066306026) completed with failure at production-preview startup detection. The checker had depended on an exact URL substring in Vite's colored output. It now safely reserves its port, drains output, and verifies HTTP readiness. The corrected production check passed locally with CI-style color settings. New remote workflow results are independent of the local results above.

## GitHub publication and remote verification

Implementation commit: `674006f54b8e85417211f03c9f7a278658482bbe`, pushed to private [devanshchaudharyy/orbit](https://github.com/devanshchaudharyy/orbit). GitHub's `main` SHA matched the local commit. The staged audit checked **281 tracked files**, **129 screenshots**, five generated development secrets and local links with zero issues. Local configuration, fixture databases/executables and test reports remain ignored.

[Initial Phase 4 workflow run](https://github.com/devanshchaudharyy/orbit/actions/runs/38069410641) independently passed frozen installation, formatting, lint, typechecks, unit tests, builds, Compose startup, the four full infrastructure checks and production verification. It failed two mobile lab axe checks because the setup code block could scroll horizontally on Linux but had no keyboard focus target. The setup and health-response blocks now have labeled, focusable regions; mobile tests verify focus and keyboard scrolling when overflow exists. The initial overall run failed and skipped the Compose account/team suite; it is not counted as passing CI. A corrective run follows. The local verification table above stands independently.

Remote infrastructure checks use the pinned MongoDB8.0.17/Redis/Garage/Mailpit Compose environment and exercise transactions, reconnect persistence, private objects and captured email. They do not prove restart-sentinel durability on the user's Windows machine or a production deployment.

## Screenshots and review (local evidence)

Retained **48 new Phase 4 captures** in [the gallery](SCREENSHOTS.md): empty team, pending invitation, populated team, member permissions, anonymous invitation/sign-in, ready acceptance, invitation dialog and access sheet; each in both themes at three widths. Existing account and tenant captures are refreshed from regression runs. Dark desktop, light mobile and the access sheet were visually inspected for hierarchy, readable text, wrapping and controls.

Preview: [local application](http://127.0.0.1:5174/app). Finish verification/profile, create an organization/workspace, then open **Team & access**. [Local mailbox](http://127.0.0.1:18025) captures development email. Test records are cleaned up, so real users start with their actual organizations rather than demonstration tenants.

## Limits and recovery

SMTP acceptance and Mongo commit are not atomic. A final commit failure after accepted email can yield an unusable link; the request reports failure and the issuer can send again. Automatic transaction retries send once. A background delivery outbox/worker and permanent audit trail remain later work. Team writes currently serialize on the organization fence to protect lifecycle invariants. Link metadata expires at its original seven-day deadline; this is not permanent invitation history.

Docker/WSL are not installed automatically. The fixture does not verify local Redis/Garage, the pinned Compose Mongo version, production SMTP, production credentials/deployment or container-restart durability. Aggregate API readiness remains 503 while Redis is absent; Mongo-backed account/team behavior and liveness can still function. Local infrastructure acceptance is not counted as passed.

After installing the documented Windows prerequisites and resolving occupied ports:

```powershell
pnpm setup
pnpm infra:up
pnpm infra:check
pnpm test:auth:compose
```

Then run the manual container-restart sentinel from [TESTING.md](TESTING.md), preserving named volumes and deleting only the sentinel records. Record actual results before closing deferred acceptance.

Phase 5 remains unimplemented. Current membership/parent checks, explicit grants, hierarchy, transactions and optimistic versions prepare project/task/subtask/assignment/filter/label/activity work. Stop after Phase 4.
