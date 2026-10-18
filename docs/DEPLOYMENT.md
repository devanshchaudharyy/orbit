# Deployment preparation

Public hosting is pending by user choice. These files prepare a single API instance, separate optional worker and HTTPS static/proxy service; no server, domain, certificate, registry publication or paid resource has been provisioned. The application remains a persistent Node service with Socket.IO, not a serverless rewrite.

## Runtime topology

`infra/release/Dockerfile` builds with Node 24.18.0 and pnpm 11.25.0 using the frozen lockfile. A separate stage installs production-only API dependencies offline from that build's store and exact frozen graph, preserving workspace links. Only compiled API/contracts application files are packaged. The web target uses nginx 1.30.6, selected after reviewing the [upstream advisories](https://nginx.org/en/security_advisories.html). Recheck base-image advisories before a real release; version pins do not replace ongoing patching or OS-image scanning.

Both runtimes use non-root users, read-only filesystems, bounded writable `/tmp`, dropped capabilities and no new privileges. The example publishes only `127.0.0.1:8443`; API 4000 and data services are not published. TLS terminates at nginx using operator-provided `fullchain.pem` and `privkey.pem`. Allow the nginx image user to read the key through restricted owner/group permissions; do not make real keys world-readable. Keep TLS assets outside the repository/image and rotate/reload them using the certificate issuer's procedure. The synthetic CI certificate is not publicly trusted.

Nginx serves hashed assets with compression and immutable caching. HTML, theme bootstrap, API responses and errors are uncached. Missing assets never fall back to HTML. A self-only JavaScript CSP blocks inline scripts and JavaScript eval. PDF.js codecs need the narrower `wasm-unsafe-eval` permission for WebAssembly compilation; this does not enable JavaScript eval ([CSP documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)). React/Radix style attributes require inline styles. Local file previews/PDF workers require blob URLs. HSTS, framing denial, no-referrer and disabled sensitive browser permissions apply. Secrets and token-bearing URLs are omitted from access logs. SPA paths refresh through `index.html`; `/api/live` forwards WebSocket upgrades.

The API trusts only the nginx service's fixed `172.30.0.10/32` address. Nginx overwrites `X-Forwarded-For` and `X-Forwarded-Proto`. Do not expose the API directly or change this to `true`, a hop count or a broad shared network. For another topology, configure explicit terminating-proxy addresses after reviewing [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/). Preserve the original HTTPS Host and exact Origin. An additional HTTP proxy needs its own reviewed client-IP trust design; TCP forwarding avoids changing the HTTP peer interpretation. If the example subnet conflicts, update the subnet, fixed addresses and trusted proxy together.

One API process is supported. Presence, subscription limits and change-stream fan-out are process-local; horizontal replication requires an authorized shared Socket.IO adapter and separate verification. MongoDB must be a replica set. Production requires private S3 storage; local disk is rejected. Use encrypted authenticated MongoDB/Redis/S3 connections across untrusted networks, network ACLs and least-privilege service credentials. The local Compose root account/Mailpit are test infrastructure, not production defaults. Set real SMTP delivery, SPF/DKIM/DMARC and monitor failures before inviting users.

## Prepare on a Docker host

Windows Docker/WSL installation remains deferred; [Docker's Windows setup](https://docs.docker.com/desktop/setup/install/windows-install/) and the existing [local recovery steps](TESTING.md) apply. No prerequisite is installed automatically. Production examples require Docker Compose with health-based startup support and an available nonconflicting subnet.

1. Copy `infra/release/env.example` to ignored `.env.production.local` and replace every placeholder. Use a secret manager or a restricted runtime env file; never pass secrets as Docker build arguments. Confirm `APP_ORIGIN` is the final exact HTTPS origin. Keep AI and billing disabled until separately configured and accepted. No model is bundled or loaded. Test billing continues to reject live keys.
2. Provide existing replica-set MongoDB, Redis, private S3 and authenticated SMTP endpoints and operator-owned certificates. Apply database/network/storage policies. Configure object versioning/retention and encrypted backup storage according to the actual provider's supported behavior.
3. In PowerShell from the repository root, set build identity and TLS directory, then build and validate without printing resolved secret configuration:

```powershell
$env:ORBIT_RELEASE_TAG = (git rev-parse --short=12 HEAD)
$env:ORBIT_TLS_DIRECTORY = 'C:/private/orbit-tls'
docker compose -f infra/release/compose.yaml config --quiet
docker compose -f infra/release/compose.yaml build
```

On Linux, use `export ORBIT_RELEASE_TAG="$(git rev-parse --short=12 HEAD)"` and `export ORBIT_TLS_DIRECTORY=/private/orbit-tls`. Image tags are local; no registry push occurs. The [filtered workspace install](https://pnpm.io/filtering) and [multi-stage build](https://docs.docker.com/build/building/multi-stage/) keep build tooling outside the runtime.

4. Once the hosting target and operations owner are approved, the prepared startup commands are:

```powershell
docker compose -f infra/release/compose.yaml up -d --no-build --wait
# Optional; keep disabled when automation is not in use:
docker compose -f infra/release/compose.yaml --profile worker up -d --no-build --wait
docker compose -f infra/release/compose.yaml ps
```

These commands have not been run against public infrastructure. Public routing, DNS, trusted TLS, firewall changes, public binding, uptime monitoring and final hosted acceptance remain pending. Do not blindly change the loopback binding to a public interface. Use the selected host's network/firewall and certificate procedures, verify private data services cannot be reached publicly, then run the acceptance checklist below.

## Production acceptance

On the approved HTTPS origin, check liveness/readiness and worker health; confirm current certificates, Origin/CSRF rejection, secure host-only cookies, private route refresh, sign-in/recovery/captured-or-delivered email, organizations/workspaces/projects/tasks, team grant/revocation, two-tab collaboration/reconnect, documents/files/PDF/download, analytics/CSV, search, preferences and audit/calendar. Verify keyboard focus and both themes at 375/768/1440. Test disabled/failed providers truthfully. Live Stripe sandbox remains a separate pending acceptance. Leave Llama unloaded unless the user explicitly requests inference.

Collect browser/network/operational evidence without secrets or real business content. Measure realistic load on the selected host with representative authorized data before claiming capacity, latency or uptime. CI asset budgets are regression limits, not field Web Vitals or a performance SLO. Do not publish synthetic CI accounts or reuse CI secrets/certificates.

## Repeatable container smoke check

On the owned local Compose fixture, after static checks and builds:

```powershell
pnpm setup
pnpm infra:up
pnpm infra:check
pnpm exec playwright install chromium
pnpm test:release
```

The last command needs Docker and OpenSSL and free loopback ports 8443 and 18026. It builds both release targets, joins only `orbit-local_default` for test dependencies, creates an isolated `orbit_test_release<uuid>` database and Redis queue, disables AI/billing, creates a one-day synthetic TLS certificate and exercises the real HTTPS stack. A dedicated pinned Mailpit container requires [STARTTLS](https://mailpit.axllent.org/docs/configuration/smtp/) and captures only this smoke run's email on loopback 18026. The API explicitly trusts the synthetic public certificate through `NODE_EXTRA_CA_CERTS`; production's encrypted SMTP requirement and certificate verification are preserved. No system trust store is changed.

It stops only its own containers, including the worker profile and captured-mail container, then deletes its unique database/queue/private objects. Secrets/certificates stay under ignored `.local/release-smoke/`; evidence is under ignored `test-results/release/`. It does not delete or restart the shared infrastructure volumes. This CI smoke check is distinct from public deployment and Windows named-volume restart acceptance.

## Health and operations

- `/api/v1/health/live`: process liveness; use for container restart decisions. `/api/v1/health/ready`: current MongoDB/Redis reachability. A 503 means remove from traffic and investigate dependencies; do not erase data or repeatedly restart healthy storage.
- Readiness does not prove SMTP delivery, S3 writes, provider availability or worker execution. Monitor those separately through authorized synthetic checks and operational logs. API JSON errors carry request IDs. Access logs omit URLs/body/cookies; never enable request-body logging to debug auth/payment issues.
- The optional worker has a compiled health command: `docker compose -f infra/release/compose.yaml exec -T worker node dist/worker-health.js`. It checks MongoDB, Redis and a recent successful dispatch heartbeat. Paused/disabled AI requires no model. Investigate stale workers, queue age/retries, exhausted quotas and storage cleanup failures.
- Alert on sustained readiness failure, 5xx/429 rates, SMTP/S3 errors, stale worker heartbeat, queue age, disk/certificate/backup expiry and unusual authentication failures. Define alert recipients and thresholds for the chosen host; no monitoring account is currently provisioned.
- API shutdown has a five-second deadline; Compose grants ten seconds. Worker shutdown can await bounded inference and is granted 110 seconds. Stop workers before planned dependency maintenance. Apply memory/CPU limits only after representative measurements on the intended host.

## Backup, restore and rollback

Back up MongoDB and private objects as one recoverable application state. Document the backup timestamp, application commit/image identity, schema/index version, object snapshot/version manifest and encryption-key custody. Store credentials separately. Quiesce writes and stop workers for a coordinated snapshot, or use a provider-supported consistent snapshot/PITR procedure. Retain object versions so a restored metadata record does not reference an already removed object. Redis is queue infrastructure; MongoDB due records are the durable workflow source. Do not restore an old queue against a newer database without reconciliation.

For an operator-managed MongoDB tool installation, the command shapes are `mongodump --uri="<source-uri>" --archive="<encrypted-backup-staging-path>" --gzip` and `mongorestore --uri="<isolated-restore-uri>" --archive="<staged-archive>" --gzip`. Use secure credential injection/history controls and encryption at rest; do not paste a real URI into shared logs. A provider-supported database snapshot is preferable where available. Restore into an isolated environment with outbound email, billing and AI disabled, restore the matching object snapshot, verify indexes/transactions and sample bytes, invalidate restored sessions/tokens, then exercise tenant isolation and normal CRUD. Reconcile billing from current canonical provider state before enabling it. A restored billing database alone must never grant stale access.

No real backup/restore drill has been executed; set RPO/RTO only after a timed drill on the selected providers. A CI database reconnect/transaction test is not backup recovery evidence. Audit records have 180-day retention and are append-only at the application boundary, not a tamper-proof compliance archive.

Retain the previous working commit, exact images and configuration. Roll back by selecting its local `ORBIT_RELEASE_TAG` and running `up -d --no-build --wait`, after checking data/schema compatibility. Do not build the new source under the old tag or delete volumes. If schema changes need a data migration, rehearse forward/rollback in isolation before release; a Git revert cannot undo persisted data. Phase 14 introduces no business schema migration. Verify health and private flows after rollback and record the operator/time/reason.

For a suspected credential incident: remove traffic, pause workers/provider actions, revoke affected sessions and credentials, rotate service secrets/certificates, preserve restricted logs and restore only from a verified clean state. Communicate through the project's approved incident channel; no external messages are sent automatically by this repository.
