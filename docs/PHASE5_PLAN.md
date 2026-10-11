# Phase 5 — projects and tasks

Implement only Phase 5 from the master brief. Preserve the existing cookie-session, CSRF, tenant, membership and version boundaries. No new dependencies are needed.

## Scope and sequencing

1. Shared strict contracts for project lifecycle, scoped project teams, tasks/subtasks, multiple assignments, task owner, due dates, priority, labels, checklists, filtering and append-only activity.
2. Separate Mongoose models, repository, service and HTTP controller/routes. Transactions bind every mutation to current organization/workspace authority, project version fences and its activity event. Soft deletion preserves history. Archived projects are read-only until restored.
3. Responsive project directory, project detail, task detail and accessible forms/confirmations. Query keys include identity and every tenant parent. Filter state lives in the URL. Empty/loading/error/conflict/success states use real API responses.
4. Real MongoDB/Supertest permission, parent, rollback, persistence and concurrency checks; browser CRUD, assignment, filtering, stale-editor, refresh, keyboard, theme and viewport verification. Extend Compose CI without replacing prior suites.
5. Update architecture, database, API, design, testing, progress, screenshots and README; run checks, commit and push to the existing private repository. Stop after Phase 5.

## Authority

All operations require verified, onboarded organization membership and explicit workspace membership. Owners/admins/project managers with that workspace grant manage its projects. A project owner may manage their project while remaining an eligible non-guest workspace member. Other members require an explicit project team grant and may manage tasks. Guests require an explicit project grant and are read-only. Grant changes are server checked, never implied by an organization role. Only workspace managers can create projects or transfer project ownership.

Project team/owner and task owner/assignees must be current organization and workspace members. Task assignments additionally require current project access and exclude guests. Revoking workspace or organization access denies project access immediately; historical references grant no authority. Project and task updates require the version originally loaded by the editor. Membership write fences coordinate mutations with Phase 4 revocation.

## Data and bounds

New `projects`, `tasks`, and `project_events` collections. Every document includes organization/workspace/project parents as applicable; all reads and writes use them. Project labels are bounded embedded definitions; task checklists are bounded embedded entries. One-level subtasks cannot be reparented or independently escape their project. Deleting a parent task soft-deletes its subtasks atomically. Deleting a project soft-deletes its tasks atomically; deleted resources cannot be restored through this phase's public API. Archive/restore is reversible. Counts and progress come from current persisted tasks.

Pages contain at most 50 records. Up to 50 project members, 30 labels, 10 assignees, 10 labels per task and 20 checklist items. Filters use escaped literal text, canonical IDs, enums and validated calendar dates. Activities record actor name at mutation time, action, target and bounded human-readable detail; they are append-only, permission checked and not an organization audit log.

## Phase boundaries and infrastructure

Project covers are original built-in vector treatments; uploaded cover images and other files belong to Phase 9. Blank and launch-checklist project templates create genuine editable tasks transactionally. Recurrence/automation, task templates, custom fields and bulk workflows remain future enhancements; milestones/dependencies/sprints belong to Phase 7, richer work views/preferences to Phase 6, live comments/mentions to Phase 8. These boundaries must be visible in documentation without nonfunctional product controls.

Docker/WSL installation remains deferred. Use the existing isolated MongoDB/Mailpit fixture for independent local verification and pinned Compose services in GitHub CI. Never count a skipped check as passed or equate reconnect persistence with container restart durability.
