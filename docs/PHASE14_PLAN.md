# Phase 14 — release hardening and deployment preparation

Authorized 18 October 2026. The user selected deployment preparation with public hosting pending. Existing live Stripe sandbox and Windows Docker/WSL/restart acceptance deferrals remain in force. Do not load Llama.

## Scope

1. Review the existing authentication, tenant, storage, Socket.IO and worker boundaries. Audit pinned dependencies without silently upgrading the foundation.
2. Harden HTTP cache/error handling and explicitly configure narrowly trusted proxy IPs/CIDRs. Preserve Origin, CSRF, secure cookies and current server authorization.
3. Remove the inline theme bootstrap so production can enforce a self-only script policy. Add accessible crash recovery without exposing exception details or automatically replaying mutations.
4. Measure production asset sizes, enforce compressed JavaScript budgets and preserve lazy charts, editor, PDF and AI routes. Keep local measurements separate from field performance claims.
5. Prepare reproducible non-root API/worker and HTTPS static/proxy containers, private networking, health checks, bounded shutdown, immutable asset caching and uncached HTML/API responses. Keep secrets, test data and local configuration outside images.
6. Add production HTTPS browser → API → MongoDB/email smoke verification, including secure session cookies, CSRF denial, refresh, private route handling, security headers, theme persistence, keyboard access and responsive axe checks. Run existing full regression and pinned Compose checks in CI.
7. Document exact release, backup/restore, rollback, monitoring and incident procedures, known scaling limits and pending hosted acceptance. Publish source and evidence to the existing private repository. Do not provision services, publish images, deploy publicly or create charges.

## Affected areas and validation

API configuration, HTTP middleware/server lifecycle, frontend bootstrap/error handling, Docker build/proxy configuration, release verification scripts and CI, with regression tests and documentation. No business collection or product API is introduced. New configuration defaults preserve local development behavior.

Run formatting, lint, strict types, Vitest/RTL/Supertest, dependency audit, builds and asset budgets before browser work. Then run production/browser and integration checks with owned synthetic records only. The completed CI result must match the final application commit. Report canceled/failed attempts separately; never count pending, skipped or unavailable checks as passed.

Public hosting, DNS/TLS-provider acceptance, live Stripe sandbox and Windows named-volume restart verification remain pending. A passing local/CI container smoke test does not establish production uptime, capacity, backup recovery or a performance service-level objective.
