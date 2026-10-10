# Phase progress

Current delivery: Phase 2 accounts, secure sessions, personal profiles, and onboarding. Final verification results are recorded in the Phase 2 section below. The full Docker infrastructure acceptance remains pending; earlier results are retained as historical records.

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

Verified user identity and personal onboarding are available for organization/workspace membership checks. Phase 3 must implement explicit membership, server tenant isolation, authorized workspace switching, and settings without inferring access from organization membership alone. No Phase 3 code is introduced here. Stop after Phase 2.
