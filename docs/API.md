# API

## Phase 11 private AI and workflow APIs

All endpoints below are relative to the authorized organization/workspace/project prefix used by analytics. Cookie sessions, completed verified profiles, explicit workspace/project access, request-ID envelopes and no-store headers apply. Mutations require exact Origin and CSRF. Rate limit: 60 AI API operations per actor/minute, with separate durable generation quotas.

| Method | Path                            | Behavior                                                                                                                   |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/ai?cursor=<runId>`            | Current configuration, recent worker heartbeat, UTC usage, 30 private actor-owned runs and project workflow configurations |
| POST   | `/ai/runs`                      | `{ requestId, mode, prompt, taskId? }`; synchronous bounded local generation with a durable retry identity                 |
| POST   | `/ai/runs/:runId/apply`         | `{ confirmed: true, tasks, priorities }`; apply reviewed edits/selections atomically with snapshot/authority checks        |
| POST   | `/ai/workflows`                 | Manager creates a confirmed daily/weekly private-draft schedule; paused by default in the UI                               |
| PATCH  | `/ai/workflows/:workflowId`     | Confirmed configuration plus original `version`; saving delegates to the current manager                                   |
| DELETE | `/ai/workflows/:workflowId`     | Original `{ version }`; soft-delete and stop future attempts                                                               |
| POST   | `/ai/workflows/:workflowId/run` | `{ requestId }`; manager requests a private briefing immediately without changing the schedule                             |

Modes: assistant, tasks, subtasks, summary, risks, weekly-report, priorities and search. Task/search/assistant requests need a prompt; subtasks require a current top-level task ID. Requests and outputs are strict and bounded. Every output reference/priority/search ID must belong to the captured authorized context. Results contain plain-text answer, references, up to five task proposals, ten priority suggestions or twenty matching IDs as appropriate to the mode. No arbitrary tool, destructive action, assignment or public message is accepted.

History and results are private to the requesting actor. Current-actor usage is visible to that actor; organization-wide usage totals are returned only to organization owners/admins and are `null` for other roles. Shared limits still apply without disclosing those totals.

Generation returns a durable run: `running`, `ready`, `failed` or `applied`. Model failures persist a sanitized `failed` run with no output, rather than a successful suggestion. Stable request retries reuse the same result and quota reservation; conflicting reuse returns 409. Disabled configuration returns 503, daily/concurrency limits 429, invalid bodies 400, oversized context 422, unavailable persistence 503 and unauthorized/missing resources 403/404. Stale draft/workflow/application conflicts return 409. Transport deadline is 90 seconds; the UI uses a 100-second request deadline and history recovery. Reported tokens can be unavailable; no cost estimate is invented. [Definitions and results](PHASE11_REPORT.md).

## Phase 10 analytics reports

Relative to `/api/v1/organizations/:organizationId/workspaces/:workspaceId/projects/:projectId`: `GET /analytics` returns the request-ID report envelope; `GET /analytics/export` returns an authenticated CSV attachment. Existing cookie, verified profile, explicit workspace membership and current project authorization apply to both. Guests and archives may read. Rate limit: 60 report/export reads per actor/minute. Responses are no-store; exports check resource authority again before returning bytes and use safe fixed filenames, nosniff and sandbox headers.

Strict query: optional `from`, `to` (UTC calendar dates) and `sprint` (canonical same-project ID). Defaults: last 30 UTC days. Ordered windows are at most 90 days and cannot end in the future. Export additionally requires `dataset`: tasks, workload, milestones, sprints, activity or burndown. Unknown keys, malformed dates/IDs and datasets return400; missing/foreign resources404; oversized reports or future end dates422; unavailable persistence503 `ANALYTICS_UNAVAILABLE`.

Reports expose generation time, current completion/status/overdue/undated counts, at most5,000 active task summaries, workload and capacity, milestone progress, immutable completed-sprint delivery, daily activity and observed burndown. Limits are50 milestones/sprints,1,000 collaborators,20,000 selected activity events and10,000 selected observations plus a single prior anchor. Limits return errors instead of silent truncation. Date selection applies to activity, scheduled forecast, sprint close dates and burndown; current task statistics remain current.

CSV rows repeat project, generation time and selected UTC window in consistent columns. Empty datasets contain headers only. Blank values mean unavailable; numeric zero remains zero. Unicode, quotes and embedded newlines are preserved, while spreadsheet formula/control prefixes are neutralized. Exports are bounded to8MiB and contain only current authorized project data. [Exact definitions/results](PHASE10_REPORT.md).

## Phase 9 documents and files

Routes below are relative to `/api/v1/organizations/:organizationId/workspaces/:workspaceId/projects/:projectId`. Cookie sessions, verified onboarding, explicit workspace membership and current project permission apply. Mutations require exact Origin and session CSRF; library mutations are bounded to60/actor/minute. JSON responses use shared request-ID envelopes; content returns private binary bytes.

| Method | Suffix                                               | Input / behavior                                                                                                                                                                  |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/documents`                                         | Optional literal title q/scoped cursor; fifty summaries, total, nextCursor.                                                                                                       |
| POST   | `/documents`                                         | `{title,content,clientId}` safe JSON and UUID; 201 including identical retries.                                                                                                   |
| GET    | `/documents/:documentId`                             | Current content and current capabilities.                                                                                                                                         |
| PATCH  | `/documents/:documentId`                             | `{title,content,version}`; shared writer edit plus immutable revision.                                                                                                            |
| DELETE | `/documents/:documentId`                             | `{version}`; author/manager; hides history and attachments.                                                                                                                       |
| GET    | `/documents/:documentId/history`                     | Optional scoped cursor; fifty immutable snapshots.                                                                                                                                |
| POST   | `/documents/:documentId/history/:revisionId/restore` | `{version}`; appends a new revision.                                                                                                                                              |
| GET    | `/files`                                             | Optional literal q/cursor/type (`image`, `pdf`, `text`), taskId or documentId; fifty active metadata rows and total.                                                              |
| POST   | `/files`                                             | Raw `application/octet-stream`, at most8MiB; query `{name,type,clientId,taskId?,documentId?}`. Type is the verified logical MIME. 201 after durable bytes and finalized metadata. |
| GET    | `/files/:fileId`                                     | Current metadata, without storage key/public URL.                                                                                                                                 |
| PATCH  | `/files/:fileId`                                     | `{name,version}`; author/manager; retains verified extension/type agreement.                                                                                                      |
| DELETE | `/files/:fileId`                                     | `{version}`; immediate logical removal, `{removed:true,cleanupPending}`.                                                                                                          |
| GET    | `/files/:fileId/content`                             | Actual checksum-verified bytes; optional `download=1`; safe disposition/no-store/nosniff/sandbox headers. Authority is rechecked after storage I/O.                               |

Safe text supports paragraphs, headings1–3, lists, quotes, code, rules, emphasis and HTTP/HTTPS/mailto links. Raw HTML, images, arbitrary attributes, unsafe links and excessive depth/size are rejected. Bounds:200 active documents/project,500 revisions/document,50,000 characters,56KiB JSON,1,000 pending/ready files/project. Files accept PNG/JPEG/WebP/PDF/UTF-8 TXT/MD/CSV with filename/extension/signature validation. Guests and archives read only. Foreign references return404, conflicts409, bounds422, oversized input413 and unavailable storage/persistence503. Pending uploads are never served. [Verification](PHASE9_REPORT.md).

## Phase 5 projects and tasks

All endpoints use shared envelopes, no-store, verified/onboarded live cookie sessions and current organization/workspace/project authorization. Mutations require JSON, exact Origin and CSRF; a persistent 100/minute actor budget and existing global limits apply. Paths below start at `/api/v1/organizations/:organizationId/workspaces/:workspaceId/projects`.

| Method / suffix                      | Input and behavior                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                              | `{cursor?,q?,status?,archived?:'true'\|'false'}`; projects, nextCursor, canCreate; defaults current projects                                         |
| `POST /`                             | `{name,description,status,priority,cover,ownerId,memberIds,template?:'blank'\|'launch'}`; 201 project DTO; workspace managers only                   |
| `GET /people`                        | `{cursor?}`; current verified workspace choices with name/role/canAssign and nextCursor; managers only                                               |
| `GET /:projectId`                    | Authorized project DTO with actual active task/done counts and current permission hints                                                              |
| `PATCH /:projectId`                  | Creation fields except template, plus version; owner/team replacement; ownership transfer requires workspace manager                                 |
| `POST /:projectId/archive`           | `{version,archived:boolean}`; archive/restore; project managers/owner                                                                                |
| `DELETE /:projectId`                 | `{version}`; atomic project/task/subtask soft deletion                                                                                               |
| `GET /:projectId/people`             | `{cursor?}`; workspace choices and project assignment eligibility; authorized non-guests                                                             |
| `GET /:projectId/tasks`              | `{cursor?,q?,status?,priority?,assignee?,label?,overdue?:'true'\|'false',parent?:'root'\|id}`; bounded task DTOs; defaults all active tasks/subtasks |
| `POST /:projectId/tasks`             | Task fields below, optional parentId (null default); 201 task DTO                                                                                    |
| `GET /:projectId/tasks/:taskId`      | Task whose organization/workspace/project parents match                                                                                              |
| `PATCH /:projectId/tasks/:taskId`    | Task fields plus version; parent cannot change                                                                                                       |
| `DELETE /:projectId/tasks/:taskId`   | `{version}`; atomically soft-delete task and direct subtasks                                                                                         |
| `POST /:projectId/labels`            | `{name,color,version}`; 201 updated project, unique case-insensitive label                                                                           |
| `DELETE /:projectId/labels/:labelId` | `{version}`; remove definition/references and version affected tasks atomically                                                                      |
| `GET /:projectId/activity`           | `{cursor?}`; newest-first append-only events and nextCursor                                                                                          |

Project names/task titles: trimmed 2–100 characters; descriptions: trimmed up to 4000. Project status: planned/active/paused/completed; task status: todo/in-progress/blocked/done. Priority: none/low/normal/high/urgent. Covers: orbit/aurora/horizon. Project team: up to 50 unique current eligible workspace user IDs; guests need explicit grants. Labels: up to 30, name 1–30, color violet/cyan/green/amber/rose.

Task fields: `{title,description,status,priority,dueDate,ownerId,assigneeIds,labelIds,checklist}`. Due date is null or an actual `YYYY-MM-DD` UTC calendar day from 1900–9999; overdue starts after that day ends unless done. Owner is null or a current non-guest project user. Assignees/labels are unique arrays with at most ten entries; labels belong to this project. Checklist: up to twenty strict `{text,done}` objects, text trimmed 1–200 characters. Subtasks have immutable parentId, require an active top-level parent in the same project, and cannot contain further subtasks.

Strict bodies/query objects reject malformed IDs/enums/filter shapes with `VALIDATION_ERROR`/400. Missing/foreign resources or explicit access use `RESOURCE_NOT_FOUND`/404; role denial uses `PROJECT_FORBIDDEN`/403. Domain eligibility/duplicate-label/bounds use `PROJECT_INPUT_INVALID`/422; stale versions use `VERSION_CONFLICT`/409; archived writes use `PROJECT_ARCHIVED`/409. Unexpected persistence failures become `PROJECT_UNAVAILABLE`/503; authentication failures can occur first. Browsers do not automatically retry mutations; transaction retries recheck authority. Historical assignment references grant no access. DTOs expose neither raw persistence fields nor deleted records.

Base path: `/api/v1`. Vite proxies this path to `127.0.0.1:4000` in development and local preview. The browser never reads backend credentials.

## Contracts

Successful responses:

```json
{ "data": { "status": "alive" }, "meta": { "requestId": "a-valid-uuid" } }
```

Errors:

```json
{
  "error": { "code": "NOT_FOUND", "message": "This endpoint does not exist." },
  "meta": { "requestId": "a-valid-uuid" }
}
```

The request identifier is a server-generated UUID and also appears in `X-Request-ID`. Client-provided identifiers are not trusted. Shared Zod schemas validate actual client health responses.

## Implemented routes

| Method/path         | Behavior                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /health/live`  | HTTP 200, `data.status = alive`; independent of infrastructure                                                  |
| `GET /health/ready` | HTTP 200, `data.status = ready` when MongoDB and Redis respond; otherwise HTTP 503, `data.status = unavailable` |

Both health responses use `Cache-Control: no-store`. Readiness HTTP 503 is a health response using the success envelope; it is not a malformed API response. Unexpected failures use the error envelope with HTTP 500.

Health routes are intentionally unauthenticated and report aggregate state only. Phase 2 adds account routes; Phase 3 adds organizations/workspaces below. Project, billing, upload, and AI endpoints remain in later phases.

JSON bodies are limited to 64 KiB. Malformed JSON returns `INVALID_JSON` / 400; excessive payloads return `PAYLOAD_TOO_LARGE` / 413. Zod request errors return `VALIDATION_ERROR` / 400. Unknown routes return `NOT_FOUND` / 404. Unexpected errors return `INTERNAL_ERROR` / 500 without stacks or credentials. Helmet sets security headers and Express framework disclosure is disabled.

## Phase 2 account routes

All paths below are relative to `/api/v1/auth`. Responses retain the shared `{data,meta}` / `{error,meta}` envelopes, server request IDs, and `Cache-Control: no-store`.

| Method/path                 | Behavior / data                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /session`              | Establish or refresh an anonymous/authenticated opaque session; `{user,csrfToken}`                       |
| `POST /register`            | Validated name/email/password; HTTP 201, rotated session; captured verification email                    |
| `POST /login`               | Email/password; rotated session; generic invalid-credentials response                                    |
| `POST /logout`              | Revoke current session and clear cookie; message                                                         |
| `POST /logout-all`          | Authenticated: revoke all user sessions; message                                                         |
| `POST /forgot-password`     | Email; generic message whether or not it exists; deliver a one-time recovery link for a matching account |
| `POST /reset-password`      | Token/newPassword; atomically consume token, update hash, revoke authenticated sessions; message         |
| `POST /verify-email`        | Token; atomically consume verification link; message                                                     |
| `POST /resend-verification` | Authenticated: send another verification link; message                                                   |
| `GET /profile`              | Authenticated: public user DTO                                                                           |
| `PATCH /profile`            | Authenticated: name/jobTitle/timezone; updated public user DTO                                           |
| `POST /onboarding`          | Authenticated and verified: profile fields plus personal/team/client useCase; updated user DTO           |
| `POST /change-password`     | Authenticated: currentPassword/newPassword; revoke all sessions; message                                 |
| `GET /sessions`             | Authenticated: owned active sessions, current marker, creation/expiry/last-seen timestamps               |
| `DELETE /sessions/:id`      | Authenticated: revoke an owned session; clear cookie if current; message                                 |

The browser first fetches `/session`, then sends `X-CSRF-Token` on every mutation along with the HttpOnly cookie. Mutations require JSON and an exact `Origin` matching `APP_ORIGIN`; untrusted cross-site fetch metadata is rejected. Do not enable broad CORS or trust arbitrary proxy headers. Session credentials never appear in response JSON; the CSRF token is separate, derived from and bound to the opaque cookie credential. Protected endpoints query the current user on the server and never accept a client-supplied user ID.

Passwords accept 12–128 characters without truncation. Email is trimmed and normalized to lowercase. Inputs are strict objects; profile/registration payloads cannot assign verification or ownership fields. Timezones must be recognized by Intl. All mutations surface request validation errors through the existing error envelope.

Verification links expire after 24 hours; recovery links after 30 minutes. Links use the configured canonical origin and a fragment token. The browser captures and removes the fragment before sending the token in a JSON POST. Link-opening GETs do not verify or reset accounts. Successful password reset/change requires a fresh login on every device.

Auth uses MongoDB-backed abuse windows and fail-closed dependency handling. An unavailable database yields `AUTH_UNAVAILABLE` / 503; unavailable SMTP yields `EMAIL_UNAVAILABLE` / 503. Failed registration delivery rolls back the account transaction so the same email can be retried. HTTP 429 returns `RATE_LIMITED` and `Retry-After`. Missing/expired login yields `UNAUTHENTICATED` / 401; invalid login/current password uses `INVALID_CREDENTIALS` / 401; invalid CSRF or origin uses HTTP 403. The UI shows actionable retry/error feedback, never a fabricated signed-in state.

## Phase 3 organization/workspace routes

All paths below are relative to `/api/v1/organizations`. Every operation requires a live authenticated, email-verified, onboarded user. Responses use the shared envelopes, request IDs, `Cache-Control: no-store`, and `Vary: Cookie, Origin`. Mutations reuse JSON, exact Origin, CSRF and a persistent per-user 60-writes/minute budget in addition to the common IP request budget.

| Method/path                                      | Input and response                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                          | Optional canonical `cursor`; `{organizations,nextCursor}` filtered by the current user's explicit organization memberships |
| `POST /`                                         | `{name,description}`; HTTP 201 organization DTO with owner role; atomically create owner membership                        |
| `GET /:organizationId`                           | Membership required; organization DTO including current role                                                               |
| `PATCH /:organizationId`                         | Owner/admin: `{name,description,version}`; updated organization DTO                                                        |
| `GET /:organizationId/workspaces`                | Organization membership + optional cursor; `{workspaces,nextCursor}` filtered by explicit workspace membership             |
| `POST /:organizationId/workspaces`               | Owner/admin: `{name,description,timezone}`; HTTP 201 workspace DTO; atomically create workspace membership                 |
| `GET /:organizationId/workspaces/:workspaceId`   | Both organization and workspace membership, verified parent; workspace DTO                                                 |
| `PATCH /:organizationId/workspaces/:workspaceId` | Owner/admin and explicit workspace membership: `{name,description,timezone,version}`; updated workspace DTO                |

Names are trimmed, 2–80 characters; descriptions are trimmed, at most 500 characters and may be empty. Time zones must be recognized by Intl. IDs and cursors are lowercase 24-character hexadecimal strings. Bodies and query objects are strict; they reject owner/user/role/organization injection and arbitrary filters or limits. Resource versions are positive integers. Lists return at most 50 resources; null `nextCursor` ends pagination.

Organization DTOs expose id/name/description/version/role/UTC timestamps. Workspace DTOs additionally expose organizationId/timezone/canManage; they never expose private user lists or grant inputs. `canManage` is a UI hint; every mutation checks server membership independently.

Missing and foreign resources both return `RESOURCE_NOT_FOUND` / 404, including a valid workspace ID under the wrong organization. Existing members without administration rights receive `TENANT_FORBIDDEN` / 403. A stale settings version receives `VERSION_CONFLICT` / 409; reload the latest values before retrying. An unverified/incomplete account receives `EMAIL_NOT_VERIFIED` / `ONBOARDING_REQUIRED` / 403. Persistence failures produce sanitized `TENANT_UNAVAILABLE` / 503; failure of the shared auth connection can produce `AUTH_UNAVAILABLE` / 503 first. Raw connection errors are never disclosed.

These are the Phase 3 resource routes. Phases 4 and 5 extend memberships and project/task work. Organization/workspace deletion/archive remain future work. Switching uses authorized GETs; no client-selected identifier grants access.

## Phase 4 teams and invitations

All routes use the shared envelopes, live cookie session, verified/onboarded identity, no-store responses, and current server membership. Mutations require exact Origin, JSON, and session-bound CSRF. Paths below are relative to `/api/v1/organizations`.

| Method and path                           | Input / behavior                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /:organizationId/team`               | Owner/admin roster and workspace grant choices. Optional canonical `cursor` / `workspaceCursor`; each list returns at most 50 plus its next cursor. Workspace names are organization administration metadata; content still requires an explicit grant. |
| `GET /:organizationId/invitations`        | Owner/admin pending, unexpired invitations, at most 50; optional `cursor`. No token or hash returned.                                                                                                                                                   |
| `POST /:organizationId/invitations`       | Strict `{ email, role, workspaceIds }`; role is admin/project-manager/member/guest, up to 50 unique same-organization workspace IDs. Actual SMTP email, seven-day expiry; 201.                                                                          |
| `DELETE /:organizationId/invitations/:id` | Empty JSON; revoke a pending invitation. Admins cannot revoke admin invitations.                                                                                                                                                                        |
| `POST /invitations/accept`                | Strict `{ token }`, 64 lowercase hex characters. Intended verified email only; transaction creates membership and explicit grants, consumes invitation, returns `{ organizationId }`. Opening a link never accepts it.                                  |
| `PATCH /:organizationId/members/:id`      | Strict `{ role, workspaceIds, version }`; replace role and explicit grants transactionally. Only the existing owner may retain owner while editing their own grants; assigning/demoting owner uses transfer only.                                       |
| `DELETE /:organizationId/members/:id`     | Strict `{ version }`; remove another member plus all grants. Owner cannot be removed.                                                                                                                                                                   |
| `POST /:organizationId/leave`             | Empty JSON; remove own membership, all grants and affected pending links. Owner must transfer first.                                                                                                                                                    |
| `POST /:organizationId/ownership`         | Strict `{ memberId, version, currentPassword }`; only owner, existing verified/onboarded recipient, bounded password verification. Atomic recipient-owner / sender-admin / owner pointer update. Existing workspace grants stay explicit.               |

Owners manage admins and all lower roles. Admins manage project managers, members and guests only; they cannot change their own admin role, assign admin, remove an admin/owner, or transfer ownership. Regular members, project managers and guests cannot read the private roster or administer grants. Project manager project privileges and guest project grants begin in Phase 5. Self-removal uses the leave route.

Membership edits use a separate version from the authority fence. Stale writes return `VERSION_CONFLICT` / 409. Duplicate pending invitations or existing recipients return `INVITATION_EXISTS` / `ALREADY_MEMBER` / 409. Wrong recipient returns `INVITATION_EMAIL_MISMATCH` / 403; expired/revoked/consumed links return `INVITATION_UNAVAILABLE` / 410. Hierarchy violations return `TEAM_FORBIDDEN` / 403 (the shared administration gate can first return `TENANT_FORBIDDEN`). Owner leave returns `OWNER_REQUIRED` / 409. Wrong current password returns `PASSWORD_INVALID` / 400; credential changes during transfer return `CREDENTIALS_CHANGED` / 409. Email/persistence failures use sanitized `EMAIL_UNAVAILABLE` / `TEAM_UNAVAILABLE` / 503.

Team mutations are limited to 60/minute per actor, invitations to 20/hour, transfer attempts to five/15 minutes; the existing global request/session budgets also apply. No automatic browser retry of mutations. Revocation/demotion/removal is checked transactionally; issuer role changes and ownership transfer revoke affected pending invitations. Existing membership cannot be altered by accepting a new link.

## Phase 6 work views

All new paths are relative to `/api/v1/organizations/:organizationId/workspaces/:workspaceId/projects/:projectId`. Verified identity, current organization/workspace membership and project access are rechecked. Existing envelopes, request IDs and no-store policy apply. Writes require Origin, JSON and session-bound CSRF; personal view mutations have a persistent 100/minute actor budget.

| Method/path                       | Input / response                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /tasks`                      | Existing filters plus sort, inclusive dueFrom/dueTo, undated=true/false and canonical cursor; {tasks,nextCursor,total} |
| `POST /tasks/:taskId/move`        | Strict {version,status?,dueDate?}, at least one supplied field; task DTO. dueDate:null clears the date                 |
| `GET /view-preferences`           | Owned preferences; absent records yield defaults with version zero without writing                                     |
| `PATCH /view-preferences`         | Strict {view,sort,group,density,weekStart,columns,showSubtasks,version}; updated DTO                                   |
| `GET /saved-filters`              | {filters}; at most twenty owned filter DTOs                                                                            |
| `POST /saved-filters`             | Strict {name,criteria}; HTTP 201 filter DTO                                                                            |
| `PATCH /saved-filters/:filterId`  | Strict {name,criteria,version}; owned updated DTO                                                                      |
| `DELETE /saved-filters/:filterId` | Strict {version}; message                                                                                              |

Views: list/kanban/table/calendar. Sorts: oldest/newest/title/priority/due-date/status. Group: none/status/priority. Density: comfortable/compact. Week start: monday/sunday. Table columns: unique status/priority/dueDate/assignees/labels. Defaults: list, oldest, no grouping, comfortable, Monday, all columns, subtasks visible.

Saved names are trimmed, 2–60 characters and case-insensitively unique per actor/project. Criteria is strict {view,sort,group,filters}; filters accept only q/status/priority/assignee/label/overdue/parent. Calendar month and visual settings are separate. Injected ownership/tenant/query fields are rejected. Other users' filter IDs are inaccessible.

Pages contain at most fifty matches and a whole-collection total at query time. Sorts use an ID tie break; null dates sort last. UTC date bounds are inclusive; undated cannot combine with date bounds or overdue=true. Overdue excludes done tasks. A cursor missing from the current scoped/filter collection returns TASK_PAGE_CHANGED / 409. Paging is a live collection, not an immutable snapshot during concurrent edits.

Task moves require write access and reject archived projects. No-op moves do not increment versions or append activity. Authorized guests and archived projects allow personal settings. Deleted resources or revoked grants return 404 for retained settings. Stale versions return VERSION_CONFLICT / 409; duplicate names/filter bounds return FILTER_NAME_USED / FILTER_LIMIT / 422. View storage failures return sanitized VIEW_UNAVAILABLE / 503. Browser mutations have no automatic retry.

[Current verification and recovery](PHASE6_REPORT.md).

## Logging

Requests log their ID, method, status, and duration. Bodies, query strings, authorization headers, cookies, and connection URIs are not logged by request middleware. Known sensitive structured fields are redacted by the logger. Dependency failures use generic development diagnostics, not raw connection exceptions. Log level is environment-controlled.

## Phase 7 delivery planning

All routes below are relative to `/api/v1/organizations/:organizationId/workspaces/:workspaceId/projects/:projectId/planning`. They use the existing success/error request-ID envelopes and current verified, onboarded identity plus explicit organization/workspace/project access. Guests can read; current non-guest collaborators can edit task plans. Managers and project owners manage milestones, sprints and capacity. Archived projects are readable and reject writes; deleted or inaccessible projects return 404. Mutations require JSON, allowed Origin and session-bound CSRF, with an actor budget of 100 per minute.

| Method | Suffix                  | Input / behavior                                                                                                |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                     | Snapshot; `from`, `to`, `cursor`, `q`, `status`, `priority`, `assignee`, `label`, `sort`, `sprint`, `milestone` |
| POST   | `/milestones`           | `{name, description, dueDate, status}`; 201                                                                     |
| PATCH  | `/milestones/:id`       | Same fields plus original `version`                                                                             |
| DELETE | `/milestones/:id`       | `{version}`; detach linked plans transactionally                                                                |
| POST   | `/sprints`              | `{name, goal, startDate, endDate}`; 201, initially planned                                                      |
| PATCH  | `/sprints/:id`          | Same fields plus original `version`; completed history immutable                                                |
| POST   | `/sprints/:id/start`    | `{version}`; freeze commitment, one active sprint per project                                                   |
| POST   | `/sprints/:id/complete` | `{version, carryTo: null \| plannedSprintId}`; freeze delivery, explicitly carry unfinished work                |
| DELETE | `/sprints/:id`          | `{version}`; planned only, detach linked plans                                                                  |
| PATCH  | `/tasks/:taskId`        | `{version, taskVersion, startDate, dueDate, estimateHours, milestoneId, sprintId, dependencyIds}`               |
| PATCH  | `/capacities/:userId`   | `{version, weeklyHours}`; current eligible collaborator                                                         |

Nullable planning fields are explicit; missing metadata/capacity has version 0. Names are 2–100 characters, descriptions/goals at most 2,000, entered effort 0–1,000 hours and weekly capacity 0–168 hours. Dates are validated UTC calendar dates; start must not follow due/end. Dependencies are at most twenty unique active same-project task IDs, with no self-reference or cycles. Completed sprint assignments cannot be rewritten by the task planning editor. Existing task edit/move endpoints also preserve the start/due ordering invariant.

The default window is today through 27 days later, inclusive. Explicit windows are at most 90 days. Task rows paginate at 100 with the six existing task sorts and ID tie breaks; `totalMatches` and workload cover all matching rows, while project/milestone/sprint totals describe all active project tasks. Milestones and sprints each have a transactional limit of 50; planning snapshots explicitly reject projects above 5,000 active tasks. Cursors describe live data; removed or filtered-out anchors return 409 `TASK_PAGE_CHANGED`.

`tasks` include existing task DTOs, planning metadata, unresolved prerequisites and advisory date conflicts. Deleted prerequisites retain their IDs with the non-sensitive label `Removed prerequisite`. No dates or statuses are automatically changed to resolve dependencies. `workloads` expose entered estimates prorated across calendar days and assignees; capacity is entered weekly hours × weekdays / 5. Unknown estimates, unscheduled and unassigned work remain explicit. `totals` count actual active tasks; completed sprint `delivery` and starting `commitment` remain frozen.

Malformed/strict schema input returns 400. Invalid business relationships and limits return 422, stale versions, dependency cycles or invalid lifecycle transitions 409, insufficient write authority 403, and unavailable persistence 503 `PLANNING_UNAVAILABLE`. The browser preserves original drafts on errors, offers explicit conflict reload, and never automatically retries writes.

## Phase 8 collaboration

Routes are relative to `/api/v1/organizations/:organizationId/workspaces/:workspaceId/projects/:projectId/collaboration`. Existing cookie/Origin/CSRF, verified onboarding, current parent/resource authorization and request-ID envelopes apply. JSON mutation budget: 100 per actor/minute. Project discussions use no taskId; task comments require an active same-project taskId query parameter.

| Method | Suffix                           | Input / response                                                                                                                                  |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/messages`                      | Optional taskId, cursor, anchor; fifty chronological messages and nextCursor. An anchor starts at the linked message after its scope is verified. |
| POST   | `/messages`                      | `{body, mentionIds, clientId}`; 201, including an idempotent replay.                                                                              |
| PATCH  | `/messages/:messageId`           | `{body, mentionIds, version}`; author only, original version required.                                                                            |
| DELETE | `/messages/:messageId`           | `{version}`; author or current project manager/owner; content-clearing tombstone.                                                                 |
| GET    | `/people`                        | Optional cursor; current eligible mention choices, fifty names/IDs without emails.                                                                |
| GET    | `/notifications`                 | Optional cursor; fifty private notifications, nextCursor and active scoped unread count.                                                          |
| PATCH  | `/notifications/:notificationId` | `{read: boolean}`; recipient only, idempotent read timestamp.                                                                                     |

Plain-text bodies are trimmed, 1–4,000 characters; mention IDs are canonical, explicit, unique and at most ten. Client identifiers are UUIDs. Missing/foreign resources return 404; guests cannot write or enumerate mention choices. Archives allow reads and reject message writes. Malformed schema input returns 400, invalid mention relationships/20,000-message limit 422, stale versions/retry payload conflicts 409, insufficient authority 403 and sanitized persistence failure 503 `COLLABORATION_UNAVAILABLE`. Create retries use the same identifier only for the same payload/thread; edits/removal are never automatically retried. The recipient inbox excludes deleted messages/tasks and inaccessible parents.

Socket.IO 4.8.4 uses same-origin `/api/live`, WebSocket transport, credential cookies and handshake auth `{csrfToken}`. Exact configured Origin and verified session/profile are required. `project:subscribe` takes only canonical `{organizationId, workspaceId, projectId}` and an acknowledgment callback with the normal success/error envelope; success data is `{available}`. `project:unsubscribe` clears the single subscription. Clients cannot supply room names or mutate content through sockets.

Server events: `project:refresh` contains only the three verified IDs; `project:presence` contains `{people: [{id,name}], total}` (twenty displayed, users deduplicated); `live:state` contains `{available}`; `project:revoked` removes access and disconnects. Current identity and resource authority are rechecked before outgoing presence/refresh and at five-second intervals. Passive checks do not extend idle expiry. Committed MongoDB streams drive invalidation; reconnect/recovery resynchronizes REST data. Stream failure does not claim live delivery, and the UI offers reconnect. Limits: 200 sockets/process, eight/user, thirty connection/subscription attempts/user/minute, 8 KiB incoming payload. One API process is supported; Redis adapter/multi-node fan-out and email notifications are outside Phase 8.

Live refetches share the general HTTP IP allowance of 600 requests/minute. Existing sign-in, recovery, actor mutation and socket budgets remain stricter. Clients coalesce invalidation events over 200ms. Account return destinations preserve only allowlisted collaboration section/inbox query choices and canonical message anchors on known local resource routes; external, malformed and arbitrary redirect parameters remain rejected.

## Phase 12 test billing APIs

Relative to `/api/v1/organizations/:organizationId/billing`:

| Method | Path                   | Access and behavior                                                                                                                      |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/entitlements`        | Current organization members; plan and limits only                                                                                       |
| GET    | `/`                    | Owner/admin; stored subscription, actual usage, current test price catalog, private invoice page and owner-only pending checkout choices |
| GET    | `/history?cursor=<id>` | Owner/admin;20row invoice pages with scoped cursors                                                                                      |
| POST   | `/checkout`            | Owner only; strict `{ requestId, quoteId, plan, interval, trial, confirmed: true }`; server-selected test prices and durable idempotency |
| POST   | `/portal`              | Owner only; strict `{ confirmed: true }`; short-lived hosted test portal URL                                                             |
| POST   | `/refresh`             | Owner/admin; strict `{}`; canonical provider state synchronization                                                                       |

Existing verified/completed account, current membership, cookie session, exact Origin/CSRF on mutations, no-store and request-ID envelopes apply. Billing API rate limit is 40 operations per actor/minute. Disabled configuration returns503 without creating a checkout. Concurrent/conflicting/expired intents return409; feature/usage restrictions402; invalid input400; missing/forbidden scopes404/403; provider/database outages503. Provider details are sanitized and secrets remain server-only. Paid endpoints do not accept client prices, amounts, customer IDs, subscriptions or success flags.

`POST /api/v1/webhooks/stripe` is a separate raw JSON route before the JSON parser, bounded to 256KiB. It requires a valid Stripe signature within 300seconds and rejects live/connected-account events. It has no cookie/CSRF dependency. Supported snapshot subscription/checkout/invoice events retrieve canonical current state, then commit transactionally before acknowledging. Failed/uncommitted work returns a retryable response. Unknown events/customers do not grant access. [Setup, accepted events, lifecycle and limits](BILLING.md).
