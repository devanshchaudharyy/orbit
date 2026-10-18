# Phase 14 — release hardening

Started 18 October 2026. [Plan](PHASE14_PLAN.md), [deployment and operations](DEPLOYMENT.md). Implementation and verification are in progress. Public hosting is pending by user choice; live Stripe sandbox and Windows Docker/WSL/restart acceptance remain deferred. Llama stays unloaded.

## Implemented

Explicit validated proxy IP/CIDR trust, uncached API errors/unknown routes, disabled API ETags, rejection of compressed JSON before inflation, safe encoding errors and explicit HTTP request/header/keepalive limits. Existing session/CSRF/Origin/tenant boundaries remain in force. The theme bootstrap is a small synchronous external script so the production CSP can prohibit inline scripts and eval. Accessible render-failure recovery focuses safe feedback and requires deliberate reload instead of replaying writes.

Non-root multi-stage production API/web images, production-only offline packaging, separate optional worker with a compiled heartbeat probe, private network/proxy trust, HTTPS, security headers/CSP, gzip, immutable hashed assets, uncached HTML/API, SPA refresh, WebSocket upgrades and bounded runtime resources. Build context excludes secrets/local configuration/test artifacts; production packages include compiled files only. No public binding, registry push or provisioning is performed.

New production smoke orchestration exercises actual HTTPS browser/API/database/email state, secure cookies, Origin/CSRF, persisted organization/workspace/project/task writes, private access, refresh, escaped text, themes, keyboard navigation, responsive axe scans and runtime/CSP errors. CI runs it alongside the existing full regression and dependency audit. Production JavaScript has a 200 KiB gzip entry/preload budget and 170 KiB per-chunk budget. Heavy charts, rich editor and PDF remain lazy. These are build regression budgets, not field performance results.

## Verification status

- Local production dependency audit: zero reported advisories across 389 production/optional dependencies. This is registry advisory coverage, not a penetration test or OS-image scan.
- Local strict types, lint and 259 unit/component/API tests in 40 files passed. Four new tests cover safe recovery, proxy configuration/trust and compressed request rejection; existing 404 checks now verify no-store and absent ETags.
- Production build passed. Measured entry/preload gzip total: 181,113 bytes against 204,800; largest chunk: 134,240 bytes against 174,080. The initial draft's 160 KiB entry budget omitted the shared preload in its estimate and failed; the final baseline explicitly includes all HTML-declared entry/preload JavaScript. Zero inline scripts and public frontend source maps.
- Local release container check cannot execute because Docker is unavailable. It is not counted as passed. Recovery: install the previously deferred prerequisites, then run the commands in [deployment preparation](DEPLOYMENT.md#repeatable-container-smoke-check). Remote verification remains pending observation.

Final builds, full regression, production/container results, exact application commit and completed CI link will be recorded after execution. No public hosting, live Stripe sandbox, Windows named-volume restart, real backup/restore drill, hosted load test or uptime claim is made.
