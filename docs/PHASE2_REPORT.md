# Phase 2 implementation and verification

Date: 10 October 2026 (Asia/Kolkata). Scope: real local accounts, secure sessions, registration, email verification, recovery, personal profiles, and onboarding. The user authorized moving beyond Phase 1 and chose to install Docker/WSL later.

## Delivered behavior

Marketing account actions now lead to registration and sign-in. Registration creates a MongoDB-backed user, hashes the password with Argon2id, rotates the anonymous session, and delivers a one-use verification link through SMTP. Verified users can complete personal onboarding and edit their name, role, timezone, and use case. Organization/workspace creation remains Phase 3.

Sign-in, sign-out, sign-out everywhere, active session review, and individual session revocation operate on real database records. Recovery captures a neutral email request, consumes a hashed expiring token, and revokes all authenticated sessions transactionally. Changing a password requires the current password and likewise requires fresh sign-in. Browser guards complement server identity checks and show loading, anonymous, expired, and unavailable-service states.

The UI includes `/auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/onboarding`, and `/account`. It uses the original design language, dark/light/system appearance, accessible field feedback, and responsive layouts. No account credential is placed in browser localStorage. Public marketing and lab pages can render without querying identity.

## Security and persistence

- Opaque random session credentials reside in HttpOnly SameSite cookies; MongoDB stores only credential hashes and enforces idle/absolute expiry before TTL cleanup. Production uses a Secure `__Host-` cookie and requires a canonical HTTPS application origin.
- Mutations require JSON, the exact configured Origin, a session-bound CSRF token, and server identity where applicable. Strict shared input schemas reject extra ownership/privilege fields. Session revocation queries include the authenticated user's ID.
- The pinned stable `argon2@0.45.1` library uses Argon2id with 19 MiB memory, two passes, one lane, fresh salts, bounded encoded parameters, and a concurrency cap. Persistent MongoDB abuse limits cover requests, registration, login by IP and email, recovery, verification, and password changes.
- Verification/recovery tokens are random, purpose-bound, hashed, expiring, and single-use. Consuming one revokes outstanding tokens of that purpose. Links use URL fragments, are removed from the address bar, and require explicit actions.
- Password reset/change and session creation use MongoDB transactions. Login writes a credential fence on the user so a concurrent password reset cannot leave a session authenticated by the old password.
- Shared request IDs and error envelopes apply to account endpoints. Logging redacts credential headers, passwords, token fields, CSRF values, connection strings, and SMTP secrets. Infrastructure failures remain bounded and do not prevent process liveness.

See [API contracts](API.md), [database collections and transaction boundaries](DATABASE.md), and [architecture](ARCHITECTURE.md) for implementation details.

## Verification environment

Normal marketing/lab preview remains at `http://127.0.0.1:5173/`, API4000. Docker and WSL are not installed; the generated normal database credentials do not authenticate against the unrelated existing MongoDB service, and Redis is unavailable. That API truthfully reports aggregate readiness 503.

Authentication verification uses separate task-owned loopback processes: installed MongoDB **8.3.4** on 27018 with the `orbit-test` replica set and `orbit_test_phase2` database; official checksum-verified Mailpit **1.27.10** on SMTP11025/HTTP18025; API4001 and browser5174. Persistent fixture files are ignored under `.local/testing`. The helper refuses occupied ports and stops only its own children. It installs no system prerequisite and changes no existing MongoDB service or credentials.

## Executed checks

| Command / check                                                                             | Executed result                                                                                                                               |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`, `pnpm run setup`                                          | Passed; exact pins, native Argon2 build, preserved ignored credentials and new auth defaults                                                  |
| `pnpm typecheck`                                                                            | Passed across all TypeScript packages                                                                                                         |
| `pnpm test`                                                                                 | **77 passed**, 12 files: 44 additional auth/contract checks plus 33 foundation checks                                                         |
| `pnpm build`                                                                                | Passed: contracts, Express API, and account-enabled production frontend                                                                       |
| `node scripts/check-production.mjs`                                                         | **5 passed**: homepage, lab route exclusion, registration direct-route refresh, incomplete reset link, and lab JavaScript exclusion           |
| `pnpm test:e2e`                                                                             | **25 passed**, marketing/lab regression; 12 theme/viewport axe scans with zero violations                                                     |
| `pnpm test:auth:integration`                                                                | **15 passed**, actual API/MongoDB/Mailpit; [saved structured results](PHASE2_INTEGRATION_RESULTS.json)                                        |
| `pnpm test:auth:transactions`                                                               | **3 passed**, actual replica-set transaction interleaving, obsolete credential rejection, and mail-failure rollback                           |
| `pnpm test:auth:e2e`                                                                        | **9 passed**; full API-backed account flow and 32 axe scans with zero violations                                                              |
| `pnpm auth:fixture status`                                                                  | Passed: MongoDB 8.3.4, API, frontend, and Mailpit respond                                                                                     |
| Compose harness guard probes                                                                | **3 passed**: malformed URI hides synthetic credentials, remote database rejected, occupied ports refused without stopping existing processes |
| `pnpm infra:up`, `pnpm infra:check`, `pnpm test:auth:compose`, container restart, remote CI | **Not executed in Phase 2**; Docker/WSL remain deferred                                                                                       |

`pnpm lint` passed with zero warnings, and `pnpm format:check` passed. No full infrastructure pass is claimed. Docker-backed acceptance remains explicitly deferred.

The account browser flow registers a unique user, reads an actual captured email, explicitly verifies it, completes onboarding, saves/reloads the profile, signs in from another browser context, revokes that session, changes a password, checks the other context was revoked, signs out, captures/uses a recovery link, and signs out everywhere. The wrong-current-password case remains on the account page and exposes a clear error. Malformed, expired, replayed, and concurrently consumed links are covered by real integration checks. A second account cannot revoke a foreign session or overwrite its profile.

Auth accessibility scans cover register/login/recovery forms, verified onboarding, and account profiles in dark/light at 375/768/1440px, plus the Security and Sessions tabs. These 32 scans supplement the 12 marketing/lab scans. Tests check horizontal overflow, theme persistence, direct-route refresh, keyboard navigation, reduced motion, explicit unavailable-service feedback, and unexpected runtime errors. Automated axe scans complement visual/keyboard inspection; they do not prove every possible accessibility scenario.

During verification, an Argon2 parameter-order mismatch was corrected, bodyless mutations were made explicit JSON requests, old-credential login races received a transactional user write fence, and invalid current passwords were prevented from clearing valid browser identity. A shared Playwright output-directory collision was fixed by separating `test-results/foundation` and `test-results/auth`. Trace review of a later recovery test showed that its generic email locator filled the old sign-in field during SPA navigation; the test now waits for the recovery heading and asserts the entered value. The final account suite ran independently with these corrections.

## Evidence and changed files

Selected screenshots are retained under `docs/screenshots/`:

- `auth-{register,login,forgot-password}-{dark,light}-{375,768,1440}.png` (18).
- `onboarding-{dark,light}-{375,768,1440}.png` (6).
- `account-{dark,light}-{375,768,1440}.png` (6).
- `account-security-light-1440.png`, `account-sessions-light-1440.png` (2).

Desktop dark registration/account and mobile light registration/onboarding captures were visually inspected, along with both-theme/size frontend review. All content is a synthetic verification account. Browser traces and HTML reports remain in ignored local output directories.

| Area          | Added / updated files                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts     | `packages/contracts/src/auth.ts`, exports, contract tests                                                                                                   |
| API           | `apps/api/src/modules/auth/*`, app/server/config/dependencies/errors/logging wiring, four auth test files                                                   |
| Browser       | `auth.css`, `lib/auth.tsx`, `components/AuthLayout.tsx`, auth/onboarding/account pages, routes, marketing account actions, auth and marketing tests         |
| Verification  | Auth fixture/check/support scripts, Compose harness, transaction tests, auth Playwright config/spec, separate foundation outputs, production route checks   |
| Configuration | Exact dependency/lockfile update, pnpm native-build allowlist, package commands, environment example/generation, ignored local artifacts, CI                |
| Documentation | README, phase scope/report/progress, architecture, database, API, design system, Windows/testing instructions, structured integration evidence, screenshots |

## Commands and reproduction

```powershell
pnpm install --frozen-lockfile
pnpm run setup
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/check-production.mjs
pnpm test:e2e
```

With the fixture running in a separate terminal:

```powershell
pnpm auth:fixture prepare
pnpm auth:fixture start
```

```powershell
pnpm test:auth:integration
pnpm test:auth:transactions
pnpm test:auth:e2e
pnpm auth:fixture status
```

Integration tests use unique synthetic accounts/messages, assert persisted database values and actual mail capture, and remove their own artifacts. Test rate-limit cleanup is restricted to the isolated test database and known fixture buckets; application limits remain enforced. Browser evidence appears under `test-results/auth/`; selected screenshots are retained in [screenshots](screenshots/).

## Limitations and next phase

Full Docker Compose verification, MongoDB 8.0.17 compatibility, Redis, private Garage storage, and container restart durability remain pending. Fixture database reconnect checks establish persisted records across connections, not a container restart result. GitHub Actions is configured to run foundation and Compose-backed auth checks, but no remote workflow has executed.

SMTP delivery is synchronous before registration transaction commit so an email failure rolls back account creation and permits retry. SMTP and MongoDB do not share a distributed transaction: a delivered link could become unusable if the database commit later fails. A durable outbox/worker belongs to the background-job phase. Recovery limits reduce account enumeration but do not claim identical network timing for every transport failure.

OAuth has no configured provider credentials and is not exposed. No external identity provider, organization membership, business records, billing, AI, publication, or deployment was added. The next authorized phase is Phase 3: organization/workspace creation, explicit membership, tenant isolation, switching, and workspace settings. Stop after Phase 2.

To finish the deferred infrastructure acceptance after installing prerequisites, follow [Windows setup](TESTING.md), resolve any occupied Compose ports, and run:

```powershell
pnpm infra:up
pnpm infra:check
pnpm test:auth:compose
```

Then execute and record the documented container-restart sentinel check. These commands are recovery instructions, not passed checks.
