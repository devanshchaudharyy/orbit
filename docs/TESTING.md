# Testing and local infrastructure

## Phase 5 projects and tasks

With the existing isolated fixture running, execute:

```powershell
pnpm auth:fixture status
pnpm test:projects:integration
pnpm test:projects:e2e
```

The integration runner restricts MongoDB to loopback and an `orbit_test*` database. It tests real HTTP/session/CSRF and transactional permissions, stale/concurrent edits, subtask parents, grants/assignments, combined filters, all paginated endpoints, activity failure rollback, retry-time revocation, fresh connections and deletion cascades. Browser checks cover actual API/database flows, direct refresh, guest access, unavailable-service retry, two tabs, keyboard overlays, both themes, 375/768/1440px, overflow, console/runtime state and axe. Synthetic fixtures are cleaned by their exact user/tenant IDs, not by clearing business collections.

The Compose harness runs these suites after the existing auth/tenant/team integration and browser checks. Production verification also checks protected project-directory/project/task deep links and their sign-in return destinations. CI preserves browser evidence and stops its services. [The Phase 5 report](PHASE5_REPORT.md) records exact executed results separately from local Docker/WSL and container-restart acceptance, which remain deferred.

Manual path: finish verification/profile → create organization/workspace → Projects → create project/team → label/task/assignees/checklist/subtask → status/filter/refresh/history → archive/restore → confirmation deletion. In two tabs, keep an editor open while saving in the other; confirm conflict reload preserves the newer result. Verify explicit guest/project/workspace grants using separate accounts, never synthetic client-only permissions.

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

## Phase 3 tenant verification

With the isolated fixture running, execute these checks sequentially. Do not rebuild or edit application modules during browser checks; Vite can reload an active page.

```powershell
pnpm test:tenants:integration
pnpm test:tenants:e2e
```

The integration driver uses Supertest, real application services, and actual MongoDB transactions. It creates unique synthetic verified users in the guarded loopback test database, logs them in through the real session API, and verifies tenant/parent substitution, explicit membership, owner/admin versus member/guest restrictions, both cursor lists, compound uniqueness, rollback, optimistic conflicts, membership revocation ordering, sanitized errors, and fresh-connection persistence. Failure and revocation are deliberately injected against owned test records only.

The browser suite signs synthetic users into the running API, creates organizations/workspaces through the UI, checks MongoDB records, switches scopes, refreshes direct links, edits settings in two tabs, exercises access failures/recovery, and signs out. Six page families are captured in both themes at 375/768/1440px. Keyboard-only creation/settings navigation, Radix focus containment/restoration, a mobile drawer, reduced motion, overflow, and axe audits are included. Cleanup targets each run's own account and tenant IDs. No synthetic tenant is seeded into a real user's account.

`pnpm test:auth:compose` now runs tenant integration and browser checks after the account checks. It requires the full Compose services and available owned fixture ports. Docker acceptance is deferred locally. The previously published workflow failed at MongoDB's health check; that check now accepts the command-line `replSet` field as well as configuration `replSetName`. The new remote workflow result must be reported independently.

For manual review, register at `http://127.0.0.1:5174/auth/register`, verify through Mailpit, finish onboarding, and follow **Open my organizations** from `/account`. Create an organization and multiple workspaces, switch scopes, edit both settings screens, and refresh. Open two settings tabs to verify stale-version feedback. Use another account against copied resource URLs and confirm no private content or edit controls appear.

## Phase 4 team verification

Start/check the isolated fixture, then run checks sequentially so synthetic account cleanup and contract-build HMR cannot interrupt another browser suite:

```powershell
pnpm auth:fixture status
# If not running: pnpm auth:fixture start
pnpm test:teams:integration
pnpm test:teams:e2e
```

The integration driver uses real MongoDB transactions and Supertest, with a controlled invitation mail adapter for failure/retry cases. Browser tests use actual SMTP capture and persisted records: invite an existing or new recipient, explicitly accept, register/verify/onboard, change roles/grants in competing tabs, remove/reinvite, transfer with password, leave, revoke, and recover from service errors. Only unique test users/tenant IDs/mail IDs are cleaned up. Both themes at three widths include page and overlay axe audits and focus trapping/restoration.

`pnpm test:auth:compose` includes team integration/browser suites after the prior phases. Default Playwright excludes auth/tenant/team suites; their separate configs target the isolated API fixture. Production checks claim port 4173 safely and test HTTP readiness without depending on Vite's colored terminal output. Direct team routes require sign-in; incomplete invitation links stay safe after refresh.

For manual review: finish account verification/profile, create an organization/workspace from `/app`, open **Team & access**, invite another email, find its message in Mailpit, and open/accept with that verified account. Edit explicit workspace grants, try a stale edit in two tabs, transfer ownership with the current password, then leave from the former-owner account. A browser refresh of a scrubbed invitation URL requires reopening the email; secrets are deliberately not persisted in browser storage.

Docker/WSL remain deferred locally. Exact recovery: `pnpm setup`, `pnpm infra:up`, `pnpm infra:check`, `pnpm test:auth:compose`, then the container-restart sentinel check below. Resolve occupied ports first; never stop unrelated services or remove volumes to make verification pass.

## Full service acceptance (all infrastructure)

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

## Phase 6 work views

`pnpm test:views:integration` uses only the isolated loopback test database, creates unique users/tenants and cleans their IDs. It covers private scope, concurrent versions, filter limits, task moves/no-op/rollback, grants/archives/deletion, UTC dates, sort pages/totals, subtasks and fresh-connection persistence.

`pnpm test:views:e2e` targets API4001/frontend5174 with the owned account fixture and a separate Playwright config. All five scenarios passed: actual moves/settings, conflicts, guests/revocation, unavailable writes and >50 tasks. Nine page/dialog families passed 54 axe scans/captures across two themes and 375/768/1440 widths, keyboard focus and overflow assertions. Focus is also checked after a successful move removes its original control.

Default browser tests exclude views.spec.ts; Compose verification appends view integration/browser suites to previous regressions. Reproduce results with the [exact commands](PHASE6_REPORT.md). Tenant integration clears only the defined loopback test request buckets before each check so prior suites cannot consume its request budget; production limits stay unchanged. Historical Phase 5 results do not verify Phase 6.

Manual flow: complete sign-in/onboarding, open an authorized project, add tasks and switch all views. Move status/date using pointer and keyboard controls, clear a date, filter/sort/group, save/apply/edit/delete filters and verify defaults in a fresh session. Check guests, archive, grants, stale writes, refresh, reduced motion and mobile scrolling.

## Manual UI checklist

Open the lab at desktop/mobile sizes; switch each theme; reload; navigate via sidebar and keyboard palette; copy tokens; submit invalid/valid form values; change priority and switch/checkbox state; open/close every overlay; check Tab/Shift+Tab/Escape; select/clear table rows; switch state tabs; refresh health and inspect the actual response. Emulate reduced motion and verify moving effects stop. All interactions are component examples unless labeled as real API status.

CI runs formatting, lint, typechecks, tests, builds, Compose-backed integration checks, and Chromium/axe checks, then preserves browser artifacts and stops services. The private GitHub repository is published; distinguish a running or failed remote workflow from independent local verification. Consult the phase report for the remote status observed at handoff.

## Phase 7 delivery planning verification

Run against the owned loopback MongoDB replica-set/API/Mailpit fixture, sequentially with the earlier suites:

```powershell
pnpm auth:fixture status
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/check-production.mjs
pnpm test:planning:integration
pnpm test:planning:e2e
pnpm test:projects:integration
pnpm test:views:integration
pnpm test:auth:integration
pnpm test:auth:transactions
pnpm test:tenants:integration
pnpm test:teams:integration
pnpm test:e2e
pnpm test:auth:e2e
pnpm test:tenants:e2e
pnpm test:teams:e2e
pnpm test:projects:e2e
pnpm test:views:e2e
pnpm format:check
git diff --check
```

The planning integration driver creates unique synthetic users/tenants and cleans only its own IDs. It asserts actual API envelopes and database records: authority/CSRF, strict schemas, graph cycles and opposite-edge races, optimistic versions, cross-module date ordering, rollback/activity, entered/null capacity, filtered forecast across pages, sprint commitment/delivery/carryover, lifecycle races, fifty-resource concurrency limits, deleted prerequisites, 100-row pagination, 5,000-task bounds, fresh-connection persistence, archives/revocation/deletion.

The dedicated planning browser config contains six scenarios. The main scenario creates actual schedules, dependencies, explicit milestone delivery, capacity and a sprint, then moves tasks and completes delivery through the UI. Eleven page/dialog families are audited in dark/light at 375/768/1440px: 66 axe scans and captures, with overflow, keyboard containment/restoration, direct refresh, reduced motion and console/runtime assertions. Other scenarios cover conflicts preserving drafts, cycles, trigger disappearance, guest/revoked grants, archives, unavailable service feedback/retry and 105 filtered records across pages. Failed attempts are diagnostics and never counted as additional passing scenarios.

Default Playwright excludes the planning suite; `pnpm test:auth:compose` appends planning integration/browser verification after previous application suites. [Phase 7 report](PHASE7_REPORT.md) records observed final results and publication status. Historical Phase 6 totals do not verify this implementation.

Manual review: open an authorized project and choose **Delivery planning**. Create milestones/sprints; use **Plan** to enter dates, effort, links and prerequisites; compare textual blockers to the Gantt; filter workload and enter capacity; start one sprint, move statuses with handles or equivalent dialogs, then complete with explicit carryover. Refresh the delivery tab and verify the frozen snapshot. Check stale edits in two sessions, read-only guests, archive behavior and mobile contained scrolling. No synthetic project is seeded into your account.

Local Docker/WSL and Windows restart acceptance remain deferred. Recovery after installing prerequisites and resolving ports: `pnpm setup`, `pnpm infra:up`, `pnpm infra:check`, `pnpm test:auth:compose`, then the manual container-restart sentinel described above. Preserve named volumes.
