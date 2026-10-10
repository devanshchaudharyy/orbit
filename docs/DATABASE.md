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

## Phase 3 implemented tenant records

| Collection                 | Fields and indexes                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`            | Name, description, ownerId, integer version, creation/update timestamps; ObjectId primary key                                                       |
| `organization_memberships` | organizationId, userId, owner/admin/member/guest role, accessRevision; unique organizationId + userId; userId + organizationId list index           |
| `workspaces`               | organizationId, name, description, Intl-valid time zone, version, timestamps; organizationId + ObjectId index                                       |
| `workspace_memberships`    | organizationId, workspaceId, userId, accessRevision; unique organizationId + workspaceId + userId; organizationId + userId + workspaceId list index |

Role values form the server permission foundation; only a creator's owner role is granted by this phase's APIs. Membership administration and invitations are Phase 4. Organization ownerId is bookkeeping, never an authorization bypass. Workspace access requires both current organization membership and explicit workspace membership with matching parents. No automatic membership is inferred from the organization's ownership or role.

Organization creation atomically inserts the organization and owner membership. Workspace creation atomically inserts the workspace and creator membership after writing the organization's authority fence. Settings updates fence organization/workspace membership and compare the caller's resource version; competing edits yield one commit and a 409 conflict. Failure before commit rolls the resource and membership back. Real tests also hold a creation transaction while a membership deletion attempts to commit, confirming authority ordering.

Membership-driven lists sort by resource ObjectId, exclude foreign/mismatched parents, and join only authorized records. Pages contain up to 50 records; the cursor is the last returned canonical 24-character ObjectId. Soft deletion, archiving, leave/remove flows, and ownership transfer are deliberately absent until their lifecycle is implemented; there are no deletion endpoints in Phase 3. Name collisions across organizations are permitted and disclose no global namespace.

Tests create unique synthetic records only in the guarded loopback `orbit_test_phase2`/`orbit_test_auth` databases and remove their own IDs. No tenant data is seeded for a real account. Fresh-connection persistence is verified; container-restart durability is still deferred.

## Phase 4 implemented membership lifecycle

`organization_memberships` adds `project-manager` to its role enum and an integer `version` (default 1). Legacy records without it are read as version 1 and receive a stored version on their next role/grant edit. `accessRevision` remains the transaction authority fence. `organizations.teamRevision` defaults to zero and advances for every team mutation. Existing unique tenant membership indexes remain authoritative.

`team_invitations` stores organizationId, inviterId, normalized recipient email, assignable role, explicit workspace ObjectIds, SHA-256 token hash, createdAt, expiresAt and pending/accepted/revoked/expired state. Indexes: unique tokenHash; unique organizationId + email only for pending invitations; organizationId + ObjectId pagination; expiresAt TTL. The application checks seven-day expiry before acceptance/listing without depending on delayed TTL deletion. Tokens are random 256-bit secrets; plaintext is never stored. Expired pending invitations are marked expired before replacement. Consumed/revoked metadata expires at the original link deadline; this is not a permanent audit log.

Transactions cover invitation creation and synchronous delivery failure rollback; acceptance plus organization membership and chosen workspace grants; role/grant replacement; removal/leave plus all grants and pending-link invalidation; ownership transfer plus both membership roles, organization ownerId/version, issuer-link revocation and credential fence. A teamRevision write and current membership writes coordinate concurrent acceptance/revocation/removal/transfer. Optimistic membership versions reject competing edits. Existing resource-setting writes share membership fences.

Ownership is represented consistently by one owner membership and organization.ownerId. There is no direct owner-role assignment, owner deletion or owner leave. Transfer requires an existing verified/onboarded member and current password. Workspace grants remain unchanged on transfer. The API owns these invariants; database clients outside the service must not bypass them.

The repository reuses existing tenant models and auth user records; it exposes only explicit DTOs. No business records, projects, tasks, notifications, permanent audit log, or deletion/archive lifecycle are added.

## Remaining planned relationships — not implemented (continued)

| Collection family                     | Relationships and anticipated indexes                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Users, Sessions                       | Implemented identity collections above; future tenant relationships extend them without accepting client membership |
| Organizations, Workspaces             | Core Phase 3 records above; future billing, lifecycle, archive/deletion policies                                    |
| Memberships                           | Explicit Phase 3 authority records above; lifecycle and role management extend them in Phase 4                      |
| Invitations                           | Phase 4 implementation above; future delivery outbox and audit retention policy                                     |
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
