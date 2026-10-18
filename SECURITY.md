# Security boundaries

ORBIT is a private development project. Public hosting and provider acceptance remain pending. This document describes implemented controls and known limits; it is not a penetration-test certification.

## Implemented controls

- Opaque MongoDB-backed sessions, Argon2id passwords, session rotation/expiry/revocation, host-only Secure HttpOnly cookies in production, exact Origin and session-bound CSRF on browser mutations. No browser-stored bearer token.
- Server-verified organization/workspace/project/resource grants for reads, writes, downloads, search and Socket.IO subscriptions. Administrative roles do not imply workspace content membership. Transaction fences and original versions protect authorization changes and concurrent writes.
- Strict contracts, bounded bodies/pages/provider calls, persistent authentication/feature rate limits, safe centralized error envelopes and fresh request IDs. Production proxy trust is explicit; forwarded headers from untrusted peers are ignored. JSON compression is rejected before inflation.
- Private validated file storage, bounded type/size checks, safe rich-text rendering and isolated local previews. No public object bucket or long-lived bearer download URL. Active content is not executed as a project document.
- AI uses authorized bounded context and validated outputs; changes require confirmation. Billing accepts test keys only and uses signed webhooks/current canonical provider state. Neither provider is silently enabled for deployment.
- Production CSP/security headers, uncached private responses, non-root/read-only containers, no secrets in build context and no request URL/body/cookie logging. Audit entries omit business content and expire after 180 days.

## Verification and limits

Run `pnpm audit:production` and the full CI workflow before release. The [Phase 14 report](docs/PHASE14_REPORT.md) distinguishes actual results from pending acceptance. A clean registry audit does not cover unpublished vulnerabilities, OS packages, provider configuration or business-logic attacks. Version pins need ongoing review; deployment images must be scanned again for the chosen registry/host. No independent penetration test, real backup/restore drill or production load test has been performed.

One API instance is supported. Public exposure, monitoring, certificate ownership/rotation, least-privilege data/provider accounts, encrypted backups, S3 retention and restore acceptance require the selected operations environment. The [deployment runbook](docs/DEPLOYMENT.md) describes those procedures and rollback. Application append-only audit records are not a tamper-proof compliance archive.

## Reporting and response

Report suspected issues privately to the repository owner through an agreed private channel. Include the affected commit, boundary, minimal synthetic reproduction and expected/actual behavior. Never post credentials, session cookies, payment secrets or private workspace data. External reports/messages are not sent automatically by this project.

For a suspected incident, follow the runbook: contain traffic, pause affected workers/provider actions, revoke compromised sessions/credentials, preserve restricted evidence and verify recovery in isolation. Do not delete production volumes or restore stale billing/session state as an improvised fix.
