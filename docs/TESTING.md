# Testing and local infrastructure

## Windows prerequisites

Node 24.18.0 and pnpm 11.25.0 are the pinned development runtime. Docker Desktop and WSL were unavailable during Phase 0 implementation.

1. In an administrator PowerShell, install WSL if needed: `wsl --install --no-distribution`. Restart if Windows requests it, then verify `wsl --version`.
2. Install Docker Desktop from the [official Windows instructions](https://docs.docker.com/desktop/setup/install/windows-install/) and enable its WSL 2 Linux-container backend. Start Docker Desktop and complete its own setup.
3. Verify `docker version` and `docker compose version` in a new terminal.
4. Check ports 27017, 6379, 3900, 1025, and 8025 are available. An existing MongoDB server may already occupy 27017; inspect its ownership rather than stopping an unrelated service automatically. If needed, adjust the local Compose published port, MongoDB URI, and infrastructure guard together before retrying.
5. From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm run setup
pnpm infra:up
pnpm infra:check
pnpm dev
```

Compose publishes local-only MongoDB (27017), Redis (6379), S3 (3900), SMTP (1025), and Mailpit UI (8025). Named volumes persist across `infra:down` and `infra:up`. Configuration generation preserves credentials and Garage’s RPC/admin secrets on repeated runs. If changing credentials after initialization, existing service volumes retain their original credentials; coordinate changes instead of blindly regenerating them.

## Automated checks

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:integration
```

Vitest covers API contracts, request IDs, configuration rejection, request limits, security headers, safe failures, local form validation, selection, appearance, and dialogs. Supertest exercises a real Express instance with injected dependency results; those tests do not substitute for database integration verification.

The logger test verifies credential/header redaction. Infrastructure boundary tests reject remote MongoDB/S3/SMTP endpoints and production database names before the CLI can perform operations.

Playwright runs real Chromium against both development servers. It checks direct-route refreshes, real health responses, console/runtime errors, themes, form controls, dialog focus trapping/restoration, drawer settings, command navigation, mobile navigation, state tabs, table selection, clipboard output, and reduced motion. Phase 1 adds public navigation, sample views/filter/task details, tour progression, proposed pricing, plan dialogs, FAQs, and 404 recovery. The marketing page and lab each run six responsive/accessibility combinations: dark/light at 375/768/1440px. Finite UI transitions settle before axe scans. A readiness HTTP 503 is an expected diagnostic only for the lab's unavailable services; the marketing page permits no unexpected console/network errors. Finish source edits before the final browser run to avoid hot-reload interference.

Screenshots appear in `test-results/screenshots/`; failures retain screenshots/traces and an HTML report. `node scripts/audit-browser.mjs` produces detailed axe output and desktop screenshots when the development server is running. Evidence selected for handoff is retained under `docs/screenshots/`.

## Real infrastructure checks

### Phase 2 isolated authentication fixture

Docker installation can be deferred while authenticating against an existing local MongoDB executable. On this machine the helper discovers `C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe`. For another installation, set `ORBIT_TEST_MONGOD` to the executable's absolute path. The helper does not install MongoDB, WSL, or Docker. `prepare` downloads the pinned official Mailpit 1.27.10 Windows archive into ignored `.local/testing/bin` and verifies the published SHA-256 digest before extraction.

```powershell
pnpm auth:fixture prepare
pnpm auth:fixture start
```

Keep that terminal open. In another repository terminal:

```powershell
pnpm test:auth:integration
pnpm test:auth:transactions
pnpm test:auth:e2e
pnpm auth:fixture status
```

The fixture owns MongoDB on 27018 (`orbit-test` replica set, `orbit_test_phase2` database), Mailpit SMTP11025/HTTP18025, API4001, and frontend5174. It refuses occupied ports and preserves unrelated services on 27017/4000/5173. Ctrl+C stops its own child process trees. MongoDB files and Mailpit's SQLite mailbox persist under ignored `.local/testing`; checks remove only their own account/session/token records and captured messages. The rate-limit reset is guarded by the explicitly isolated database and clears only known fixture IP buckets, allowing repeat verification without loosening production limits.

Auth tests exercise real email capture, Argon2 verification, session rotation, single-use tokens, profile persistence, onboarding verification requirements, expiry before Mongo TTL deletion, password changes/reset and revocation, and abuse limits. The browser suite runs full forms and mail links through the Vite proxy and asserts database results. Foundation browser tests remain separate because the normal development API can truthfully report unavailable dependencies.

`test:auth:transactions` uses the actual Mongoose repository and an isolated replica-set database to hold a login at its credential fence while a password change attempts to commit, reject a previously observed password hash after a change, and verify registration rollback when an injected mail transport fails. The injected failure does not stop Mailpit or affect another browser run. These transaction tests cover persistence behavior; successful mail delivery is verified separately through the real SMTP/browser flows.

The fixture's installed MongoDB version is recorded with the results. Passing against MongoDB 8.3.4 does not establish verification of the pinned Compose MongoDB 8.0.17 image, Redis, Garage, or container restart durability. Aggregate readiness still returns 503 while Redis is absent, even when account workflows succeed.

### Compose authentication checks

After Docker/WSL are installed and the full infrastructure check succeeds:

```powershell
pnpm infra:up
pnpm infra:check
pnpm test:auth:compose
```

Stop the isolated fixture first so ports 4001/5174 are available. The Compose auth harness derives a loopback-only `orbit_test_auth` database from generated configuration, starts owned API/web processes on 4001/5174, uses the configured Mailpit instance, and runs the real auth integration and browser suites. GitHub Actions includes this harness. No remote workflow run is claimed locally.

### Full service acceptance

`pnpm test:integration` / `pnpm infra:check` fail nonzero if any service check fails. Checks execute concurrently and use bounded network operations. They restrict themselves to loopback endpoints and an explicitly named `orbit_test` database:

- MongoDB transaction commit, aborted-transaction invisibility, reconnect persistence, and cleanup by run ID.
- Redis uniquely named key set/get/reconnect/delete, with TTL fallback.
- Private S3 object upload/download, anonymous-access rejection, deletion, and absent-object verification.
- SMTP submission to Mailpit, uniquely matching message capture/content verification, and deletion of that message ID only.

The CLI never clears unrelated records or mail. If a service disappears after a write, restore it and remove only that check’s uniquely identified artifact. MongoDB/Redis test artifacts expire automatically; S3 cleanup failure prints an explicit warning.

## Container-restart persistence: manual acceptance

This test requires running Docker services and has not been executed while Docker is missing. Create a unique sentinel in the isolated MongoDB test collection and private S3 bucket, plus a Redis key without a short expiration. Run `pnpm infra:down`, then `pnpm infra:up`; read all three sentinels using the same local credentials and remove only those sentinels. Confirm Mailpit retained a uniquely identified test message across restart. Never use `down -v` for a persistence check.

## Production lab gating

Run `pnpm build` with `VITE_ENABLE_DESIGN_LAB` unset, then `node scripts/check-production.mjs`. Its owned preview on port 4173 verifies the marketing homepage, a not-found page at `/dev/design-system`, absence of lab content from production JavaScript, account registration on direct-route refresh, and the incomplete reset-link state. These are frontend build/route checks; real account mutations use the separate API-backed auth suite. Preview manually with `pnpm --filter @orbit/web preview`. To verify an explicitly enabled build in PowerShell:

```powershell
$env:VITE_ENABLE_DESIGN_LAB = 'true'
pnpm --filter @orbit/web build
Remove-Item Env:VITE_ENABLE_DESIGN_LAB
pnpm --filter @orbit/web preview
```

After that check, rebuild normally to restore the lab-disabled artifact.

## Manual UI checklist

Open the lab at desktop/mobile sizes; switch each theme; reload; navigate via sidebar and keyboard palette; copy tokens; submit invalid/valid form values; change priority and switch/checkbox state; open/close every overlay; check Tab/Shift+Tab/Escape; select/clear table rows; switch state tabs; refresh health and inspect the actual response. Emulate reduced motion and verify moving effects stop. All interactions are component examples unless labeled as real API status.

CI runs formatting, lint, typechecks, tests, builds, Compose-backed integration checks, and Chromium/axe checks, then preserves browser artifacts and stops services. The workflow is configured locally; a GitHub CI run is not claimed until this repository is published and the workflow actually executes.
