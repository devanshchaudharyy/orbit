# Phase 13 — discovery and administration

Implemented and verified locally on 18 October 2026. [Plan](PHASE13_PLAN.md), [operating guide](ADMINISTRATION.md).

Implementation is complete; final browser regression and publication/Compose CI verification are in progress. The user selected calendar export and local notification controls. No external provisioning, deployment, model load, paid operation or business-data seed was introduced. Live Stripe sandbox and Windows Docker/WSL/restart acceptance remain deferred. Stop before Phase 14.

## Delivered

Real global name/title search across authorized organizations, workspaces, projects, tasks, documents and ready files; literal input, scope/type/archive filters, database pagination and final permission/child-availability checks. A responsive full page and Ctrl/Cmd+K dialog provide actual API results and implemented navigation, with keyboard traversal, focus trapping/restoration and private/unavailable feedback. No external search provider or stored recent queries.

Versioned private inbox preferences affect real future mention/task-comment deliveries and retain existing history. Delivery and preference edits share a transaction fence. Drafts survive conflicts/background updates until explicit reload. Organization owners/admins receive actual usage counts, paginated/filterable audit metadata, existing settings/security/billing links and versioned calendar integration controls.

Audit hooks append within local mutations and capture action/actor/resource identifiers rather than content or secrets. Records start with this phase and expire after 180 days. A failed mutation rolls back its audit entry. Authenticated calendar downloads use current project permissions, explicit organization enablement, bounded date/task windows, stable UIDs, correct exclusive all-day end dates, escaped text and UTF-8 line folding. They are manual imports; no hosted calendar synchronization is claimed.

## Evidence so far

- Strict types, lint, production builds and 254 unit/component/API tests across 39 files passed. The nine new contract/calendar/direct-link tests cover validation, safe returns, escaping, Unicode line folding, stable identifiers and cursor filter binding.
- All 23 administration integration checks passed against an owned MongoDB test database with real authentication, CSRF and transactions. Earlier application integration suites passed after adding transactional audit hooks and notification delivery preferences.
- All seven final browser scenarios passed directly after the attachment-parent correction, in 1.9 minutes. They include 60 axe scans with zero violations in both themes at 375/768/1440, real notification suppression, stale preference drafts, actual calendar-file bytes, audit pagination, private guest/revocation, unavailable retries and search pagination/archive-filter resets. The gallery retains 60 new captures, totaling 693 PNGs.
- Review found that file search needed to exclude ready attachments whose task/document parent was deleted or foreign. A new regression failed with one leaked result before correction; joins now filter those parents before pagination and recheck their availability before returning. All 23 integration checks passed afterward. An owned earlier browser run was stopped before rebuilding shared contracts; interrupted scenarios are not counted as passed.
- Production verification passed 25 route/build checks, including search, notification preferences and administration sign-in returns. No external calendar account or live payment was exercised. The selected integrations require no additional dependency or environment credential.

## Commands and publication

Executed: `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run --maxWorkers=2`, `pnpm build`, targeted contract/calendar/direct-link Vitest suites, `pnpm --filter @orbit/api exec tsx ../../tests/integration/administration.ts`, earlier feature integration commands through direct `tsx`, `pnpm exec playwright test -c playwright.administration.config.ts`, the targeted pagination browser scenario, and `node scripts/check-production.mjs`. Static checks are completed before browser work; no shared-contract build overlaps the final browser run.

The existing private repository will receive the application commit after local checks. Full Compose CI and final regression totals, commit/run identity, screenshots and publication audit will be recorded here when observed. No unexecuted check is passed by assumption. [Local search preview](http://127.0.0.1:5174/app/search). Phase 14 has not started.
