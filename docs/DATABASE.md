# Database

## Phase 10 observations and report snapshots

`sprint_burndown_observations` stores organization/workspace/project/sprint parents, a server-generated source identifier, observedAt, total/done/remaining task counts, known remaining estimate hours and unestimated remaining task count. Unique sprint/source prevents duplicate committed sources; parent/sprint/observedAt/ID supports ordered range reads and one preceding anchor. Records are append-only. Sources are committed activity IDs or a unique sprint-completion marker. Current parent authorization protects retained observations after grants or resources disappear.

The project activity transaction records changed current active-sprint totals. First observation is actual observed state, never an invented historical start. Completion records before unfinished plans move and preserves completed known estimate hours/unknown counts in the frozen delivery snapshot. Older deliveries without these fields remain unknown. Reads do not backfill or add observations. Rollbacks remove both activity and metric writes; unchanged totals produce no observation. Task scope additions/removals and reopened work can raise or lower the curve.

Project events gain a parent/createdAt/ID index for bounded report windows. Reports read current task/planning/member data consistently in a fenced transaction; plans join only active task IDs. Scoped counts and indexed history stay bounded, with explicit errors when a smaller window is needed. Future tenant purges must include observation rows. No TTL or automatic retention policy is introduced. [Phase10 report](PHASE10_REPORT.md).

## Phase 9 project knowledge

`project_documents`: organization/workspace/project parents, title, safe JSON, author/latest writer, optimistic version, create UUID/fingerprint, timestamps and deletedAt. Parent/deletion/descending-ID and unique project/author/clientId indexes support current fifty-row lists and deduplicated creates. Project fences enforce current writes and the200-document bound.

`document_revisions`: same parents, documentId, immutable title/content, version, writer and createdAt. Unique document/version and parent/document/ID indexes protect append-only history/paging. Create/edit/restore, revision and activity commit atomically; failed event writes roll back content and history. Restore copies a verified snapshot into a new version. Maximum500 revisions/document.

`project_files`: same parents, nullable same-project task/subtask or document, validated name/type/size/SHA-256, author, UUID/fingerprint, generated private key, version, timestamps, pending/ready/deleted status and cleanedAt. Scoped status/ID, unique project/author/clientId and cleanup indexes protect paging, retries and reconciliation. Filenames never select storage paths.

MongoDB and object writes cannot share a transaction. Reserve a durable pending intent, persist bytes, then recheck current parents/membership transactionally and finalize with activity. Pending data is never served; identical retries recover put/finalization failures. Retries renew their cleanup lease. Deletion hides metadata first and removes bytes afterwards, explicitly reporting cleanup failure. `pnpm files:cleanup` examines at most100 deleted, expired pending (24h), or orphaned rows per invocation. Deleted parents hide attachments before physical cleanup; archives retain readable files. Future tenant purges must include all three collections and private objects.

Development/test persist actual private bytes under ignored `.local/files`; production requires private S3 and CI uses Garage. No public URL, browser credential, worker or user-account seed. New storage/database instances verify persistence separately from deferred Windows container restart acceptance. [Phase9 report](PHASE9_REPORT.md).

## Phase 5 implemented project work

| Collection       | Stored relationships and indexes                                                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`       | organizationId/workspaceId, ownerId, up to 50 memberIds, name/description/status/priority/cover, up to 30 embedded labels, archived/deletedAt, version/writeRevision and timestamps. Indexes: `{organizationId,workspaceId,deletedAt,archived,_id}` and `{organizationId,workspaceId,memberIds,_id}`                                          |
| `tasks`          | organization/workspace/project parents, immutable nullable parentId, nullable ownerId, up to 10 assigneeIds/labelIds, title/description/status/priority, nullable UTC calendar dueDate, up to 20 checklist items, version/deletedAt/timestamps. Indexes: scoped project+deletedAt+_id, project+parentId+deletedAt, project+assigneeIds+status |
| `project_events` | organization/workspace/project parents, actorId/name snapshot, action, targetName, bounded detail and UTC creation time. Scoped project+descending _id index. Append-only through public APIs                                                                                                                                                 |

All reads/writes verify matching parents and current authority before using these indexes. Mutations run in MongoDB transactions, write current actor/target organization and workspace membership fences, and increment project writeRevision. A project settings version changes only with settings/labels/lifecycle; task versions change with task edits and cascade cleanup. Transaction retries recheck membership, project grants and assignment eligibility. Business mutation and activity either both commit or both roll back; templates include their tasks/events in the same transaction.

Project deletion and parent-task deletion atomically soft-delete their active descendants. Deleted data/history remains stored without a public restore/purge endpoint; retention policy is future work. Archive is reversible and blocks content writes. Revoking an organization/workspace/project grant denies current access immediately; task owner/assignment IDs may remain historical references. Changing/removing a project label cleans active task label references and increments affected task versions. Progress counts only active tasks/subtasks and done status, not demonstration values.

Subtasks are limited to one level. Lists contain at most 50 records and canonical ObjectId cursors; activity is newest-first, other pages ascending. All API DTOs normalize IDs/timestamps and omit deleted/internal fence fields. Activity preserves names at mutation time without exposing credentials or permanently replacing the future organization audit log. A fresh-connection persistence check is executed; container restart is separate deferred acceptance.

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

| Collection family                 | Relationships and anticipated indexes                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Users, Sessions                   | Implemented identity collections above; future tenant relationships extend them without accepting client membership |
| Organizations, Workspaces         | Core Phase 3 records above; future billing, lifecycle, archive/deletion policies                                    |
| Memberships                       | Explicit Phase 3 authority records above; lifecycle and role management extend them in Phase 4                      |
| Invitations                       | Phase 4 implementation above; future delivery outbox and audit retention policy                                     |
| Projects, Tasks                   | Implemented Phase 5 records; Phase 7 planning below; future custom-field and retention enhancements                 |
| Comments, realtime Events         | Verified project/task parents; tenant + parent + creation-time indexes                                              |
| Notifications                     | Tenant and recipient ownership; recipient/read-state/time index                                                     |
| Documents, Attachments            | Verified project parent; version relationship; private object key; tenant + parent lookup                           |
| Subscriptions, AIUsage, AuditLogs | Organization ownership; provider-event idempotency; bounded usage windows and audit pagination                      |
| Automations                       | Authorized workspace scope, validated triggers/actions, idempotent execution tracking                               |

Use MongoDB ObjectIds internally and string representations in JSON. Represent timestamps as UTC ISO-8601 strings over the API. Never serialize raw Mongoose documents with private fields. Index definitions are finalized alongside the phase that introduces each collection; this table is an architecture direction, not a migration already applied.

Critical ownership transfer, invitation acceptance, and other multi-record invariants use transactions. Queries always include a server-verified tenant scope and verified parent resource relationship. Soft deletion applies to recoverable business resources; security tokens/session invalidation need explicit lifecycle rules. Cursor pagination and concurrency/version rules will be defined in each module’s phase before its endpoints are implemented.

## Phase 6 personal views

`work_preferences` stores userId, organizationId, workspaceId, projectId, view/sort/group/density/weekStart/columns/showSubtasks, version and timestamps. The unique compound index is {userId,organizationId,workspaceId,projectId}. Absence yields defaults/version zero; first explicit save creates version one.

`saved_task_filters` stores the same verified parents, name, lowercase nameKey, strict criteria, version and timestamps. Its unique index adds nameKey, enforcing case-insensitive names per actor/project. Creates are bounded to twenty with a transactional project fence. Reads include authenticated actor and every parent. Criteria never grants authority.

Personal writes recheck current membership/project grants in transactions and retain original versions. They coordinate with revocation through existing membership/project fences and create no project activity. Soft-deleted projects retain inaccessible settings; future permanent purges must clean scoped settings alongside projects/users.

Task calendar queries add {organizationId,workspaceId,projectId,deletedAt,dueDate,_id}. Aggregation casts verified parents, shares common filters, returns counts and uses deterministic sorting/cursors. Computed title/priority/status sorts do not promise index-only execution. Move transactions update only status/date and version, plus one activity record; rollback protects both. No-op moves change neither.

All 24 real-database checks passed, including empty-filter round trips, concurrency, rollback and fresh-connection persistence. [Verification report](PHASE6_REPORT.md).

## Retention and restart checks

`pnpm infra:down` preserves named volumes. The CLI verifies records survive new client connections. To verify container-restart durability once Docker is available, run the documented manual sentinel check in TESTING.md. Reconnection persistence is not a claim that container-restart durability has been executed on this machine.

## Phase 7 planning collections

Implemented collections use organization/workspace/project parent IDs and existing project access checks; none replace task content.

| Collection           | Stored records and indexes                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_milestones` | Name, normalized name key, description, target UTC date, explicit delivery status, version and timestamps; unique project/name key                                            |
| `project_sprints`    | Name/key, goal, start/end UTC dates, planned/active/completed state, version, start/completion timestamps, immutable commitment/delivery totals; unique project/name key      |
| `task_plans`         | Task ID, nullable start/estimate/milestone/sprint, prerequisite task IDs, version/timestamps; unique parent/project/task, project/sprint and project/milestone lookup indexes |
| `project_capacities` | Current collaborator ID, nullable entered weekly hours, version/timestamps; unique parent/project/user                                                                        |

Metadata absent from MongoDB maps to version 0 and nullable fields. No 40-hour default, effort, velocity or actual-time data is invented. Model DTOs preserve all task descriptions, checklists, labels and assignments.

Project/membership write fences serialize planning changes with existing task and authority mutations. Transactions recheck current authority and original versions, persist planning plus any due-date change and activity together, validate the project dependency graph, and roll back the entire operation on failure. This prevents opposite-edge cycle races, concurrent active sprint starts, resource-count limit races and stale capacity creation. Dependency targets must be active tasks in the same project. Soft-deleted prerequisite IDs remain visible as missing without exposing deleted titles.

Sprint start freezes committed total/done/entered hours/unestimated count. Completion freezes current delivery before moving unfinished plans to explicit backlog or a planned sprint. Completed tasks retain historical sprint links; subsequent task status edits do not rewrite the snapshot. Milestone status is explicit and does not mark tasks done. Deleting a milestone or planned sprint detaches linked plans, increments metadata versions and preserves task content/activity. Completed sprints cannot be edited/deleted. Project soft deletion retains planning records behind inaccessible parent scope, consistent with existing task/history retention.

Read snapshots bound the active project graph at 5,000 tasks, compute actual summaries and full filtered workload, and paginate DTO rows at 100. Fresh-connection tests verify persisted plans/capacity/history. Windows container restart durability remains a separate deferred acceptance check.

## Phase 8 conversations and notifications

`collaboration_messages` stores verified organization/workspace/project IDs, nullable taskId (null is project discussion), authorId, plain-text body, explicit mention IDs, create retry clientId/inputHash, optimistic version, edited/deletedAt and timestamps. The compound parent/project/task/ID index serves chronological fifty-row pages; unique project/author/clientId deduplicates retried creates across threads. A conflicting payload or thread reuse returns 409. At most 20,000 messages including tombstones are accepted per project under the project fence. Message removal clears body/mentions and retains a versioned tombstone; no content is copied into activity records.

`collaboration_notifications` stores the verified parents, messageId, recipient userId, mention/comment kind, nullable readAt and createdAt. A unique message/recipient index prevents duplicate notifications; user/parents/descending ID supports private inbox pages. Current message content is joined at read time, so deleted messages/tasks do not appear and edits update excerpts. Read flags belong only to the authenticated recipient, preserve their first read timestamp on repeated read requests, and are reversible. The unread count covers the current active scoped collection, independently of the loaded page.

Message, current eligible recipient notifications and project activity commit in one transaction, sequentially within the session. Actor/recipient membership and project fences coordinate grant changes and retries. Authors edit their own messages; authors/managers remove them. Guests and archived projects reject message writes. Current parents and grants protect retained data after project deletion or membership revocation. Mention display names are resolved only for current eligible collaborators; historical revoked identities use `Former collaborator`. Future permanent purges must include both collections.

Presence is process-local and never stored as durable membership. MongoDB database-level change streams observe committed updates/deletions, and scoped API queries recover missed work after reconnect; a replica set is required. [Phase 8 verification](PHASE8_REPORT.md).
