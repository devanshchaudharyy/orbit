# Phase 2 implementation plan

Scope: authentication, secure opaque sessions, registration, email verification, recovery, personal profile management, and onboarding. Local development only. Organizations/workspaces and membership remain Phase 3/4; project features, OAuth without credentials, billing, and deployment are not introduced.

## Architecture and contracts

Extend shared Zod contracts with bounded, strict registration/login/password/profile/onboarding inputs and public user/session DTOs. Mount an auth module under `/api/v1/auth`, separated into HTTP/controller, service, and Mongoose persistence. Reuse the application error envelope and request IDs. Keep health serving independently when MongoDB is unavailable.

Persist users, token hashes, anonymous/authenticated session hashes, and abuse windows in MongoDB with unique and TTL indexes. Use Argon2id with individual random salts, bounded parameters, timing-safe checks, and bounded hashing concurrency. Sessions rotate after login/registration, use HttpOnly SameSite cookies, require Secure and HTTPS origin configuration in production, and enforce idle/absolute expiry in application logic. Validate origin and a session-bound CSRF token on mutations. Password reset consumes a hashed one-time token and invalidates sessions transactionally; password change requires current credentials. Email verification uses purpose-bound expiring tokens and is required before completing onboarding.

Use synchronous Nodemailer SMTP delivery with explicit failure handling, canonical-origin links, and no raw secrets in logs. Recovery responses avoid account enumeration. Session management lists only the current user's records and checks ownership when revoking sessions. Store personal use case, name, job title, and valid IANA timezone; do not create an organization during onboarding.

## Browser deliverables

Add `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, and `/auth/verify-email`. Protect `/onboarding` and `/account` with a real API session check, including loading, unavailable-service retry, unauthenticated redirects, and mutation feedback. Use TanStack Query for session data and RHF/Zod for forms. Store no authentication credential in localStorage. Reuse original tokens, Inter, accessible primitives, dark/light/system themes, and reduced motion. Update marketing CTAs to real account routes while retaining the explicitly illustrative product preview.

## Verification and dependencies

Use the pinned stable argon2@0.45.1 password-hashing library and current Mongo/Nodemailer packages; no hosted identity vendor or paid service is provisioned. Add component/API tests for validation, unavailable dependencies, CSRF, cookies, expiry, safe errors, and protected operations. Verify real register → email capture → verify → onboarding → profile → logout/login → recovery using a separate loopback Mongo replica set and Mailpit fixture. The fixture uses an isolated test database and task-owned processes, leaving unrelated local services untouched. Preserve the original default dev preview and run the isolated auth preview on 5174/API4001.

Run lint, formatting, strict types, unit/component/API tests, production builds/route checks, existing browser regression, real auth integration, and auth browser/axe checks at 375/768/1440px in both themes. Retain screenshots, exact results, limitations, and progress. Docker/WSL remain unavailable; a successful alternate Mongo/Mailpit fixture does not count as verification of the pinned Docker stack, Redis, Garage, or container-restart durability.

Affected areas: contracts; API auth/config/startup/errors; browser routes/auth/forms/account/styles/marketing; environment examples/setup; local fixture and verification commands/configuration; CI; architecture/database/API/design/testing/progress documents. Stop after Phase 2.
