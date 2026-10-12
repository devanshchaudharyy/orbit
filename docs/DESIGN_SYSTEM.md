# ORBIT Design Language

## Phase 5 project experience

The project directory uses layered semantic cards, original orbital SVG cover treatments, actual completion counts and progress bars. Project detail balances tasks/filters with labels and persisted activity; task detail gives context/checklist and people/labels separate readable surfaces. The layout collapses cleanly to a single column on mobile. No controls point to unimplemented views or features.

Accessible native selects/date controls, explicit labels, paginated teammate choices, Radix dialogs/sheets and confirmation copy use existing design tokens. Long overlays scroll within the viewport, retain Tab/Shift+Tab focus and restore the initiating control on Escape; navigation clears local editor state. Query/loading/empty/no-match/error/retry/archived/success/conflict states represent actual API results. Reduced motion removes movement; theme colors retain readable contrast.

The directory, project/task screens, archive state and creation/edit overlays were audited in both themes at 375/768/1440px, with 54 WCAG A/AA axe scans and no violations. [Screenshots](SCREENSHOTS.md) and [verification report](PHASE5_REPORT.md) record browser/API/database evidence. Earlier phase sections below describe the design's evolution.

A shared interface language for focused work: quiet layered surfaces, violet actions, restrained cyan highlights, and purposeful motion. The original ORBIT SVG mark and orbital illustration are code-native vector artwork. Inter Variable is self-hosted.

## Tokens

| Semantic token     | Dark      | Light     | Meaning                        |
| ------------------ | --------- | --------- | ------------------------------ |
| `--background`     | `#0d0f15` | `#f7f8fc` | Page canvas                    |
| `--surface`        | `#14171f` | `#ffffff` | Cards and overlays             |
| `--surface-raised` | `#1b1e29` | `#f0f1f8` | Raised controls                |
| `--foreground`     | `#f1f2f8` | `#202235` | Primary text                   |
| `--muted`          | `#9b9fb3` | `#5e637b` | Secondary text                 |
| `--subtle`         | `#8990a6` | `#696e82` | Metadata and hints             |
| `--primary`        | `#a99aff` | `#6950d4` | Primary actions and highlights |
| `--cyan`           | `#76d7e5` | `#096e80` | Secondary accents              |
| `--focus`          | `#b8aaff` | `#6950d4` | Visible keyboard focus         |

Use semantic tokens rather than copying palette values into business components. The gallery’s copy actions read the actual computed theme values. Radius scale: 6/10/16px. Spacing is based on a 4px unit. Motion uses 140/220ms transitions and a restrained entrance; reduced motion disables continuing animation and smooth scrolling.

Dark is the default. Light and system modes are complete implementations. Preferences use the versioned `orbit.theme.v1` localStorage key; blocked storage falls back to an in-memory preference. An inline bootstrap applies appearance before React renders. System mode observes OS color-scheme changes.

## Components

The source-owned UI package uses shadcn/ui component patterns, class-variance-authority variants, class merging, and Radix primitives. `components.json` records the shadcn style/token/alias configuration. This is an original ORBIT styling layer, not an integration with a screenshot-only component source.

- Buttons: primary, secondary, outline, ghost, danger; default, small, and icon sizes.
- Inputs: labels, text inputs, textareas, validation feedback, select, switch, checkbox.
- Structure: cards, semantic badges, tabs, scrollable tables, skeletons, accordions.
- Layers: portal dialogs, side sheets, dropdown menus, tooltips, and theme-aware Sonner toasts.

Dialogs have titles/descriptions, contained focus, Escape handling, and focus restoration. Forms associate errors with their fields. Icon controls have accessible names. The command palette supports Ctrl/⌘ K, filtering, arrows, Home/End, Enter, Escape, and focus transfer to the chosen section.

## Lab boundaries

`/dev/design-system` is development-only unless `VITE_ENABLE_DESIGN_LAB=true` explicitly enables it for a production-preview build. Since Phase 1, `/` serves the public marketing website. Sample forms validate local inputs; sample table selection updates local UI state only. Loading/error/success tabs are explicitly labeled demonstrations. The health panel is the live API integration and never invents readiness or metrics.

Responsive navigation becomes a modal sidebar on smaller screens. Tables scroll inside their container. Both themes are checked at 375, 768, and 1440px. Automated axe checks complement screenshot and keyboard inspection; they do not by themselves prove every possible accessibility requirement.

## Phase 1 marketing presentation

The marketing page reuses the original mark, self-hosted Inter, semantic tokens, theme persistence, buttons, tabs, dialogs, and accordions. Wide orbit lines and restrained violet illumination connect the hero and product illustrations. Editorial sections explain the intended workflow; the interactive workspace is clearly labeled sample content. Shared heading selectors are scoped to `.marketing` so its styles do not alter the lab.

The sample board stacks into readable columns on mobile. Board/List tabs and filters work locally; task cards open descriptive dialogs. Tour and pricing dialogs return focus to the originating control, while finishing the tour focuses the preview. Pricing marks amounts and feature sets as proposed. Mobile theme controls appear in the footer; desktop controls appear in the header. Keyboard outlines remain visible and reduced motion suppresses entrance effects.

## Phase 2 account interfaces

Account routes share a responsive split layout: original orbital artwork and short account context beside a focused form. Mobile puts the form first and removes decorative space. Registration, login, recovery, reset, and email verification reuse semantic surfaces, self-hosted Inter, shared buttons/inputs, and the existing appearance control. Status messages distinguish pending, invalid input, delivery failure, unavailable services, and completed actions.

Password inputs provide accessible reveal controls. Client validation associates error messages with fields and moves focus to invalid inputs; the API validates independently. Submitted forms expose busy states and prevent repeated clicks. Token links are removed from the address bar after capture and require an explicit POST action. Recovery confirmation uses the same neutral message for existing and unknown accounts.

Protected onboarding collects personal preferences and blocks completion until email verification. The account page supports profile edits, password changes, active session review, individual revocation, and signing out everywhere. Unavailable identity services show a retry screen without inventing a logged-in user. Phase 3 adds the real organizations entry from the account page.

Appearance persistence continues to use only `orbit.theme.v1`; authentication credentials remain in HttpOnly cookies. Keyboard focus, responsive overflow, reduced motion, and axe checks accompany the real account browser flows.

## Phase 3 application workspace

The application area extends ORBIT's semantic tokens with a restrained charcoal sidebar, violet selection, quiet breadcrumbs, native organization switching, private workspace initials, responsive resource cards, and an original SVG/CSS orbital welcome illustration. Content comes from authorized API responses. Counts describe accessible records and show a plus when additional pages remain; no charts or fabricated activity appear.

Creation uses accessible Radix dialogs with validation, contained/restored focus, pending submissions, and server errors. Settings use a stable form version, explicit conflict reload, and success feedback. Mobile replaces the sidebar with a focus-managed drawer. Theme controls, skip links, page-title/main focus, reduced motion, and responsive typography remain shared with prior pages.

Real captures and axe/layout checks cover the empty and populated organization entry, organization overview, workspace overview, organization settings, and workspace settings in both themes at 375/768/1440px. Phase 4 adds team navigation below; projects/tasks remain planned.

## Phase 6 work perspectives

List, Kanban, table and calendar extend semantic surfaces and violet selection. Native filters, actual loaded/total counts and incomplete-collection messages describe real records. Lists/tables offer grouping; calendars identify UTC days and separate undated scheduling targets.

Named tabs support Arrow keys/Home/End. Wide board/table/calendar regions have labels, keyboard focus and contained scrolling. Move buttons support keyboard/touch alternatives to pointer handles. Versioned Radix dialogs retain original snapshots and restore focus. Pending, error, conflict/reload and successful API outcomes are explicit. Drag overlays disable drop animation; styles honor reduced motion. Order follows server sorting.

Private preferences control density, week start, columns and subtasks. Saved filters require explicit save/apply. Nine page/dialog families passed both themes at 375/768/1440 with 54 axe scans, overflow and focus checks. Explicit select labels avoid option text becoming part of a control's name. Focus restoration waits for the refreshed collection and uses the selected tab if the original task control is removed. [Verification report](PHASE6_REPORT.md).

## Phase 4 team experience

Team & access uses the same semantic surfaces, violet invitation accents, quiet role badges and original initials. The roster and pending invitations show actual server records; empty invitations explain the next useful action. Members see their role and access boundaries without the administrator roster. Workspace checkboxes make grants explicit; organization roles never visually promise access to all spaces.

An invitation dialog and access sheet use Radix focus trapping, Escape, and explicit focus restoration to their initiating controls; after removal the roster heading receives focus. Confirmation dialogs explain removal, revocation, leaving and ownership transfer. Transfer requires a current password with the shared accessible visibility control. Pending submissions disable actions; success/error/conflict reload states come from real API outcomes.

The acceptance page reuses the account layout and handles anonymous, unverified, incomplete-profile, ready, malformed, wrong-recipient and unavailable invitation states. Sign-in/registration/profile completion preserve the invitation's tab-memory credential; refresh asks the user to reopen their email. Forms use strict shared Zod schemas; new team forms keep controlled local values while TanStack Query owns remote records.

Both themes are captured at 375/768/1440px for six page states and two overlay families. Keyboard trapping/restoration, reduced-motion preference, horizontal overflow, console/runtime state, and WCAG A/AA axe checks accompany browser → API → MongoDB → SMTP verification. Theme-transition animations settle before contrast measurements.

## Phase 7 planning surfaces

Delivery planning reuses semantic light/dark tokens, type, spacing, original task components and Radix dialogs. Five keyboard-addressable tabs expose timeline/Gantt, milestones, sprints, workload and delivery. Schedule bars use actual dates with a contained, labeled horizontal scroll region; decorative SVG connectors have equivalent textual prerequisites and advisory conflict feedback. Unscheduled/out-of-window tasks remain available below the chart.

Milestone cards separate explicit delivery status from linked progress. Sprint cards show lifecycle, frozen commitment and delivery, alongside the existing Kanban board. Workload cards distinguish forecast, entered/unspecified capacity, unknown effort, unscheduled work and unassigned work. No invented performance or burndown visuals are shown. Task filters/window controls appear only where they affect the displayed calculation.

Validated milestone, sprint, task-plan, capacity and completion dialogs retain original versions and drafts on errors. Prefilled textarea labels use stable explicit associations. Error feedback receives focus; success is announced once. Dialog containment, Escape, trigger restoration and active-tab fallback are verified. Page overflow is prohibited; chart/board scrolling stays contained. Reduced-motion preferences remove transitions.
