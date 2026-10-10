# Architecture

## Implemented in Phase 0

```mermaid
flowchart LR
  Browser[React / Vite lab] -->|same-origin /api proxy| API[Express API]
  API --> Health[Health service]
  Health --> Mongo[MongoDB replica set]
  Health --> Redis[Redis]
  CLI[Infrastructure CLI] --> Mongo
  CLI --> Redis
  CLI --> Garage[Garage private S3]
  CLI --> Mailpit[Mailpit local email]
```

The pnpm monorepo shares runtime Zod response contracts, source-owned React components, and strict TypeScript configuration. Workspace imports use `workspace:*` and explicit package exports. Contracts compile before API/web checks or development startup. The frontend is a client-rendered Vite application, not a server-rendered framework.

The API separates process startup from application construction. Configuration is validated once, logging is structured and redacted, HTTP middleware owns request IDs/error formatting, and health routes receive infrastructure dependencies through an interface. Production TypeScript compiles to Node ESM. Graceful shutdown stops HTTP acceptance and closes connections, with a five-second deadline.

TanStack Query owns server responses; Zustand owns appearance and command-palette visibility only. Forms use React Hook Form and Zod. The design lab is loaded lazily only when development or an explicit build flag enables it.

Liveness is independent of database availability. Readiness checks MongoDB and Redis concurrently, with bounded connection/command timeouts and deduplicated in-flight probes. HTTP responses disclose only aggregate health, not credentials, hostnames, or individual dependency errors.

## Phase 1 public website

`/` serves the lazy-loaded marketing page in development and production. `/dev/design-system` remains development-only unless `VITE_ENABLE_DESIGN_LAB=true` explicitly enables it. Unknown routes render an accessible recovery page linking home. Native hash links navigate to product, feature, pricing, and FAQ sections and support refresh.

Marketing interactions use local React state: sample Board/List views, a design filter, task details, a guided tour, billing-period comparison, and selected-plan information. Shared Radix dialogs own focus containment, with explicit restoration to each opening control. The theme control is shared with the lab. Marketing CSS scopes shared heading selectors to prevent route-to-route style conflicts. Motion respects the user's reduced-motion preference.

No marketing endpoint, waitlist, account registration, payment collection, or product persistence is introduced. Prices and included features are explicitly proposed previews. The current backend and health contracts remain unchanged; future feature descriptions are labeled as plans. This phase needs no new dependencies or services.

## Future module conventions

Future feature modules organize routes/controllers, services, persistence, validation, and tests within their domain. Controllers authenticate and validate HTTP input; services authorize resources and enforce business rules; repositories perform explicitly scoped queries. Do not introduce unused business modules or database models in Phase 0.

Organizations are tenant and billing boundaries. Workspaces require explicit access for regular members; owners/admins retain organization administration rights. Project-level access is checked inside the authorized workspace. Guests receive explicit grants. Client-supplied IDs never establish membership or access.

Every tenant resource will carry `organizationId`; nested resources also carry their workspace/project identifiers. Resource lookup must use these verified parent relationships together, including cross-resource assignments and links. Permission tests must include a second organization and attempts to substitute foreign IDs. No tenant authorization is claimed as implemented in Phase 0 because no tenant resource endpoints exist.

Phase 2 implements Argon2id passwords, opaque MongoDB-backed session cookies, cookie security attributes, session-bound CSRF defense, exact Origin checks, and MongoDB-backed authentication abuse controls. Expired sessions are rejected by application logic before TTL deletion. Authentication does not imply organization or workspace membership.

Socket.IO is introduced in Phase 8 on the persistent Node API. Room subscription and event emission require the same membership and resource checks as HTTP. Redis adapters and a separate BullMQ worker are introduced only when realtime scaling and background jobs require them. Redis is infrastructure in Phase 0, not an authorization source.

AI and billing execute on the backend in their phases. AI receives authorized context and validated outputs; destructive or externally visible actions require confirmation. Billing remains test-mode until expressly re-scoped. All entitlement checks are server-side.

## Phase 2 identity boundary

The API auth module separates controllers, business services, and Mongoose repositories. It reuses the health adapter's bounded Mongo connection while leaving readiness's Redis requirement intact. Password hashing uses the exactly pinned stable `argon2@0.45.1` library; Node 24's native Argon2 API is still a release candidate, so the maintained password-oriented library avoids a custom PHC formatter. Hashing concurrency is bounded and encoded parameters are checked before verification.

Users and anonymous/authenticated sessions are real database records. Sign-in/registration rotate the session credential, and reset/change-password revoke sessions transactionally. Profiles and onboarding persist only personal details. Only a verified email can complete onboarding. No tenant or business-resource grants are created. Production configuration requires HTTPS origin and uses a Secure `__Host-` cookie; local HTTP uses the development cookie name.

The browser keeps session data in TanStack Query memory. Public marketing/lab routes do not fetch identity merely to render. Auth and protected routes distinguish initial loading, anonymous sessions, unavailable services, and authenticated users. Protected API operations always enforce identity independently of the route guard. Token links use fragments, are removed from the address bar, and require explicit form/button POST actions.

Local verification can use a separate Mongo replica set on 27018 with Mailpit on SMTP11025/HTTP18025, API4001, and frontend5174. These are task-owned processes and an isolated database, preserving existing services and credentials. The ordinary Compose environment remains the reproducible full-stack setup; the fixture is explicitly a local auth test convenience and does not verify Docker, Redis, or object storage.

## Phase 3 tenant boundary

The `tenants` module separates shared input/DTO contracts, authenticated HTTP controllers, service eligibility checks, and explicitly scoped MongoDB persistence. Every request reuses live Mongo session validation, exact Origin, session CSRF, request IDs, and no-store responses. A verified, onboarded identity is required. Anonymous/authenticated identity alone never grants organization access.

Organization membership is the source of tenant authorization. Only owners/admins create workspaces or update settings. Workspace lookup additionally requires a membership containing the actor, organization, and workspace identifiers; the resource must have the same organization parent. Even owners/admins do not receive implicit workspace content access. They retain organization administration rights. Unknown and foreign resources share a 404 response.

Creation transactions save each resource with its creator membership. Settings transactions increment authority records to conflict with future membership revocation/role edits, and update the resource only when its submitted version matches. The browser keeps the version paired with its editable values across background refetches; it reloads only when the user explicitly chooses to resolve a conflict. Lists join from indexed, server-filtered membership records and return at most 50 resources plus a continuation cursor.

`/app` and nested organization/workspace routes form the persistent application area. URL identifiers select the active scope and survive refresh; they are validated on the server. Query keys contain both actor identity and resource parents. Account changes/sign-out cancel and remove prior tenant caches. Public marketing remains separate; new pages are lazy-loaded. A responsive sidebar becomes a Radix drawer on mobile. Navigation opens only implemented organization/workspace/account pages.

No tenant membership mutations, invitations, ownership transfers, projects, tasks, global command palette, or realtime subscriptions are introduced. Phase 4 extends the authority records and must retain their transaction fences. No new library or deployment platform is introduced.

## Phase 4 team boundary

The `teams` HTTP adapter validates strict shared inputs and reuses account protections and verified profile eligibility. `TeamService` owns opaque credential generation, hashing, SMTP delivery and password verification. `TeamRepository` owns scoped persistence, transaction policy and authority fences. No new library is installed.

Every team mutation writes the current actor's authority record and the organization's `teamRevision` inside the transaction. Acceptance writes the issuer's current authority instead of trusting a historical role. The organization fence serializes acceptance, revocation, role/grant changes, removal, leaving and ownership transfer; retries re-evaluate policy. This favors clear invariants in the foundation. High-volume organizations may later split the fence into narrower domain coordination, retaining equivalent race tests.

Owner and admin administration never bypasses explicit workspace content membership. Team administration may enumerate the organization's workspace names to administer grants. Owners alone control admins/ownership. Project managers, members and guests currently have no administrative privilege. Role edits have optimistic membership versions separate from accessRevision. Removal/leave deletes membership and all grants, and revokes affected pending links. Transfer changes the only owner and organization pointer atomically, after current-password verification and a credential write fence; it neither creates workspace grants nor deletes accounts.

Invitation credentials appear only in email fragments, are scrubbed from the address bar and held in browser tab memory across SPA sign-in/profile completion. They never enter browser storage, API DTOs, or request logs. Refresh requires reopening the email. Acceptance uses an explicit protected POST and verified recipient email. SMTP delivery is synchronous, sends at most once per transaction retry, and aborts persistence on delivery failure. A delivered link can become unusable if final commit fails; a worker/outbox is future work.

Team and invitation pages are lazy-loaded and query caches stay scoped to the actor/organization. Independent roster, grant-choice and pending-invitation reads run concurrently after the organization is authorized. Overlay forms retain their observed member version across background updates; conflict reload closes the stale form and fetches current data. Members see an access explanation and leave action without fetching the private roster.

## Deployment boundaries (unchanged)

Phase 0 is local-only. The eventual frontend can use static hosting; the API needs a persistent Node runtime supporting future realtime connections. Production uses Atlas, managed Redis, private S3-compatible storage, and a transactional email service. Garage/Mailpit and the single-node replica set are local development choices. Hosting/provider provisioning and deployment belong to Phase 14.
