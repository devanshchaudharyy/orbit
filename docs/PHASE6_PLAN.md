# Phase 6 — work views and personal preferences

Implement Kanban, list, table, calendar, drag-and-drop, saved filters and user preferences from the master brief. Stop after Phase 6. Preserve Phase 5 project authority and optimistic versions.

## Decisions

- All four views share server filtering and stable, bounded sorting/pagination. Show actual total matches and loaded counts; partially loaded boards/calendars never imply completeness. Calendar queries the displayed UTC month, with a separate undated collection. List/table support status or priority grouping.
- Drag task handles between Kanban statuses or calendar dates/undated space. Ordering follows the selected server sort; within-column manual ranking is outside this phase. Equivalent explicit move controls support keyboard and touch users. Mutation versions, current project grants, archive rules and transactional history apply to every move.
- MongoDB stores personal project view defaults and up to twenty named saved filters per user/project. Guests can manage their own preferences/filters while remaining read-only for tasks. Versions reject concurrent preference/filter edits. Revoked users cannot read or change retained settings.
- View/sort/group/month and active filters live in the URL. Explicit URL choices take precedence over saved defaults. Save preferences explicitly to persist view, sorting, grouping, density, week start, table columns and subtask visibility across sessions. Saved filters contain only validated query choices, never memberships or resource permissions.
- Introduce exact `@dnd-kit/react` 0.5.0 after checking React 19 peer compatibility and official APIs. Keep the persistent Express service and original semantic design system.

## Verification

Strict contracts, unit/component tests, real MongoDB/Supertest permission/transaction/rollback/pagination/concurrency tests and browser → API → database → view checks. Exercise pointer/keyboard moves, cancellation, stale records, guests, grants, archive, saved defaults/filters, both themes and 375/768/1440 widths, direct refresh, console errors and axe. Extend Compose CI with the new suites; retain prior regressions.

Update README, architecture, database, API, design system, testing, progress, report and screenshot gallery. Commit/push to the existing private repository after checks. Local Docker/WSL and restart acceptance stay deferred; CI verifies pinned Compose independently. No deployment, provider provisioning, billing, AI or business-data seed.

Timeline/Gantt, dependencies, milestones, sprints and workload views belong to Phase 7; realtime/comments to Phase 8. No unimplemented navigation or decorative controls.
