# Phase 4 — Teams and permissions

Implement invitations, membership lifecycle, roles, explicit workspace grants, and safe ownership transfer. Projects and project grants remain Phase 5 work. No paid services or deployment.

1. Extend shared contracts with bounded, strict team inputs and responses. Add the project-manager role; its project privileges begin in Phase 5.
2. Persist hashed, email-bound, single-use invitations with seven-day expiry. Deliver through the configured SMTP adapter. Accept only with a verified, onboarded account matching the invited address; never mutate from a GET or expose a raw token in API responses/logs.
3. Authorize every team read/write against current organization membership. Owners manage admins and transfer ownership; admins manage lower roles only. Team writes use transactional authority fences and an organization fence. Membership versions reject stale edits. Workspace grants must reference this organization; organization administrators may administer grants without gaining workspace content access themselves.
4. Remove organization membership and all workspace grants together. Owners must transfer ownership before leaving. Transfer requires the current password and an existing member, atomically updating both roles and the organization owner. No invitation can assign owner.
5. Build a responsive team management page and explicit invitation acceptance page with real API data, loading/error/empty/success states, confirmation dialogs, keyboard access, and both themes. Keep invite credentials only in tab memory after scrubbing the fragment; reopening the email recovers a refreshed page.
6. Verify contracts, server authorization and concurrency with real Mongo transactions, SMTP capture, browser flows, accessibility, themes and viewport widths. Run existing regression checks. Document exact executed results and Docker-dependent blockers; update screenshots, README and progress.

Invitation delivery is synchronous in this phase. SMTP acceptance and Mongo commit cannot be made atomic without a future outbox: a delivered link may become unusable if commit ultimately fails. Automatic transaction retries must not send the same email twice. No invitation implicitly alters an existing member's role or grants; revoke it and edit that member explicitly.
