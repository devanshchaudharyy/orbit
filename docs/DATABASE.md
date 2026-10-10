# Database

## Phase 0 state

No business collections, Mongoose models, tenant records, or seed users are created. The health adapter only connects and pings. The infrastructure CLI uses `orbit_test.phase0_smoke` for isolated real transaction tests, creates a TTL index on `expiresAt`, and removes its own run IDs. It does not drop collections or databases.

Docker Compose runs MongoDB 8.0.17 with authentication and the `rs0` single-node replica set. The replica-set key is generated locally. Initialization is idempotent: initialize only when the set is uninitialized, then wait for a writable primary. The host-based API uses `directConnection=true`; this accommodates the local replica-set hostname without extra Windows DNS configuration. This is a local development arrangement, not production high availability.

Redis uses a generated password and AOF persistence. Keys from the CLI have a five-minute TTL and a unique `orbit:test:phase0:` prefix. Garage stores data/metadata in a named volume and initializes a private bucket. Mailpit persists captured email in SQLite in its named volume.

## Phase 2 implemented identity records

Authentication uses the configured application database and these collections. The test fixture uses the separate `orbit_test_phase2` database and uniquely named test users; it never touches the existing MongoDB service on port 27017.

| Collection         | Fields / indexes                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth_users`       | Unique normalized email, Argon2id PHC passwordHash, internal authRevision credential fence, name, jobTitle, timezone, personal useCase, emailVerified, onboardingCompleted, timestamps |
| `auth_sessions`    | Unique SHA-256 tokenHash, CSRF hash, optional userId for anonymous sessions, creation/last-seen/idle/absolute expiry; TTL on expiresAt; userId + expiresAt index                       |
| `auth_tokens`      | Unique tokenHash, userId, verification/recovery purpose, creation/expiry; TTL and userId + purpose indexes                                                                             |
| `auth_rate_limits` | Hashed scope/identifier/window key, atomic counter and expiry; TTL                                                                                                                     |

No raw password, session credential, verification link, or recovery link is stored in MongoDB. Public DTOs list permitted profile fields explicitly. TTL deletion is cleanup; application queries enforce expiry before Mongo's asynchronous TTL removal. Default session idle expiry is 1440 minutes, bounded by an absolute 168-hour expiry; environment settings can shorten these independently.

Transactions cover registration (user, verification token, new session, revocation of the prior anonymous session), login rotation with a user credential-write fence, verification token consumption and email flag, password reset with token consumption and all-session revocation, and password change with current-hash comparison and session revocation. Synchronous SMTP registration delivery occurs before transaction commit; a failed delivery rolls the account back, and an automatic transaction retry reuses identifiers and sends at most once. A commit failure after SMTP acceptance can leave an unusable emailed link; the UI reports failure and the account flow can be retried. A background delivery worker/outbox is a later extension, not claimed here.

Profile/onboarding writes update only the authenticated user. Onboarding requires a verified email and persists personal preferences without creating an organization or granting membership. Session revocation queries include the authenticated user's ID. Login's credential fence prevents an old-password login racing a reset from recreating a session after reset invalidation.

## Planned relationships — not implemented

| Collection family                     | Relationships and anticipated indexes                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Users, Sessions                       | Implemented identity collections above; future tenant relationships extend them without accepting client membership |
| Organizations, Workspaces             | Organization ownership and billing boundary; workspaces indexed by organization and deletion/archive state          |
| Memberships                           | Organization/workspace membership; unique resource + user membership; active-state lookup                           |
| Invitations                           | Scoped recipient, inviter, expiry, and one-time hashed token; expiry TTL; explicit acceptance/revocation state      |
| Projects, Tasks                       | Organization/workspace/project parents; compound tenant + status/due-date indexes; bounded cursor pagination        |
| Comments, Events, Milestones, Sprints | Verified project/task parents; tenant + parent + creation-time indexes                                              |
| Notifications                         | Tenant and recipient ownership; recipient/read-state/time index                                                     |
| Documents, Attachments                | Verified project parent; version relationship; private object key; tenant + parent lookup                           |
| Subscriptions, AIUsage, AuditLogs     | Organization ownership; provider-event idempotency; bounded usage windows and audit pagination                      |
| Automations                           | Authorized workspace scope, validated triggers/actions, idempotent execution tracking                               |

Use MongoDB ObjectIds internally and string representations in JSON. Represent timestamps as UTC ISO-8601 strings over the API. Never serialize raw Mongoose documents with private fields. Index definitions are finalized alongside the phase that introduces each collection; this table is an architecture direction, not a migration already applied.

Critical ownership transfer, invitation acceptance, and other multi-record invariants use transactions. Queries always include a server-verified tenant scope and verified parent resource relationship. Soft deletion applies to recoverable business resources; security tokens/session invalidation need explicit lifecycle rules. Cursor pagination and concurrency/version rules will be defined in each module’s phase before its endpoints are implemented.

## Retention and restart checks

`pnpm infra:down` preserves named volumes. The CLI verifies records survive new client connections. To verify container-restart durability once Docker is available, run the documented manual sentinel check in TESTING.md. Reconnection persistence is not a claim that container-restart durability has been executed on this machine.
