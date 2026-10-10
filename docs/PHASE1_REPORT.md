# Phase 1 — public marketing website

Date: 10 October 2026 (Asia/Kolkata). Scope: local implementation only; no publication or provisioning.

## Implementation

The public homepage now serves at `/` in development and production. It introduces ORBIT with original orbit artwork, a responsive sample workspace, product direction, proposed plan comparisons, FAQs, and a final tour action. Shared tokens provide dark, light, and system appearance with persisted preferences and no theme flash. Self-hosted Inter and existing UI dependencies are reused.

Navigation uses real section anchors. Mobile navigation expands, closes on selection, and supports Escape. Unknown routes provide a link home. The development lab remains at `/dev/design-system`, and its code stays excluded from the default production build.

The sample workspace supports Board/List views, a design-task filter, and task-detail dialogs. A three-step tour explains the product direction and hands keyboard focus to the preview. Monthly/yearly comparisons update proposed prices and billing totals; each plan opens its own information dialog. Dialogs trap focus and restore their opening controls. FAQs expand with Radix keyboard behavior. Entrance motion and smooth scrolling respect reduced motion.

Sample tasks and people are explicitly demonstrations. Feature descriptions distinguish the current preview from planned capabilities. Proposed prices are USD illustrations, subject to change. No account, waitlist submission, subscription, checkout, customer testimonial, or business record is fabricated. Authentication belongs to Phase 2 and billing to Phase 12.

## Affected files and dependencies

- New: `apps/web/src/pages/Marketing.tsx`, `marketing.css`, `apps/web/src/components/ProductPreview.tsx`, shared `ThemeControl.tsx`.
- Updated: browser route entry and metadata, lab theme imports/title, default production verification script, root-route lab test.
- Added: `apps/web/test/marketing.test.tsx`, `tests/e2e/marketing.spec.ts`.
- Updated: README, architecture, design-system, testing, and phase progress documentation; retained browser screenshots.
- No direct dependencies, lockfile changes, new API endpoints, schemas, or services were needed.

## Verification

Run from the repository root:

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
node scripts/check-production.mjs
pnpm test:e2e
```

Final executed results are recorded in [phase progress](PHASE_PROGRESS.md). Unit tests cover sample filtering and details, billing-period selection, tour restart, and the existing API/configuration/component contracts. Browser tests cover the marketing page and lab in both themes at 375, 768, and 1440px, axe WCAG A/AA scans, horizontal overflow, unexpected console/runtime errors, focus trapping/restoration, pricing, mobile navigation, persisted appearance, native section navigation, direct refresh, reduced motion, and 404 recovery.

The first browser pass found an anchor color overriding the primary button's foreground, low-contrast sample metadata in light mode, and missing focus restoration for programmatically opened dialogs. These were fixed. Visual inspection found a shared heading selector inheriting the lab's flex layout; marketing heading styles are now scoped. A run overlapping source edits produced hot-reload console warnings; verification was repeated against stable sources.

Screenshots are retained as `docs/screenshots/marketing-{dark,light}-{375,768,1440}.png`. These are real Chromium captures, not generated mockups. Desktop and mobile compositions were visually inspected.

## Local preview and limitations

```powershell
pnpm dev
```

Visit `http://127.0.0.1:5173/`. The lab is available at `http://127.0.0.1:5173/dev/design-system` and still exercises the live health API.

Phase 0 infrastructure blockers remain: Docker Desktop/WSL are absent and the generated MongoDB, Redis, Garage, and email configuration has not passed integration verification. Phase 1's static marketing interactions do not depend on those services. Infrastructure checks and container durability were not rerun or counted as passed in Phase 1. Follow TESTING.md's Windows setup, then run `pnpm infra:up` and `pnpm infra:check` before database-backed authentication work. GitHub Actions is configured but has not run remotely. The project remains local and unpublished.

Phase 1 stops here. Phase 2 will introduce real authentication, secure opaque sessions, account recovery, profiles, and onboarding after infrastructure readiness is addressed.
