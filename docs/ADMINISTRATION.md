# Search, settings and administration

Phase 13 adds global discovery, quick commands, private notification controls, organization audit/usage pages and authenticated calendar downloads. It reuses the existing profile, password, session, organization/workspace, team and billing settings. No external account, SDK, environment variable, cloud resource or model is required. The user selected calendar export and local notification controls as this phase's integrations. See [the implementation plan](PHASE13_PLAN.md) and [verification report](PHASE13_REPORT.md).

## Find work and move between it

Open `/app/search`, or press Ctrl+K / Cmd+K within the workspace shell. The palette searches the current organization when one is open; the full page can search all organizations. Enter 2–120 visible characters. Matching is literal, case-insensitive substring matching on organization/workspace names and project/task/document/file titles. Document/task bodies, messages, email addresses and AI history are not searched. ORBIT stores no recent-search history and sends no search to an external provider.

Choose a type, optional organization and whether to include archived projects. All organizations are searched on the server without limiting scope to the first page of the organization switcher. “Load more organizations” expands the filter choices. Results show authorized organization/workspace context and open existing resource routes. File results open the project's existing file library. Deleted projects, tasks/documents and attachments with deleted/foreign parents are excluded; only ready files appear.

Search requires current organization membership, explicit workspace membership and the existing project authorization rules. Organization owners/admins/project managers retain their existing project authority within explicitly granted workspaces. Guests need explicit project membership; a historical ownership field does not grant a guest access. Search checks these joins before pagination and rechecks current access and child availability before returning titles. Revoked results disappear on refresh or the 15-second refresh interval.

Pages contain at most 25 rows, ordered by type and identifier. Opaque cursors bind the query, type, organization and archive filter. Changing filters starts from the first page. Concurrent writes are not a frozen historical snapshot; refresh to discover new/changed matches. Database search is bounded to three seconds and reports an unavailable response on timeout; it never presents a partial scan as complete. Narrow a broad search if necessary. This implementation uses existing compound tenant indexes and literal database queries, not Atlas Search or an external indexing service.

In the palette, type to search, use Arrow Down to enter results, arrows to move, Enter to open, Tab to move between controls and Escape to close. Focus returns to the opening control. Quick commands link only to implemented destinations; administration/billing commands depend on the current role. Opening another dialog does not stack a global command dialog over it.

## Notification preferences

Open `/app/preferences` or **Notifications** in the workspace sidebar. Mentions and comments on tasks you own/are assigned to are enabled by default. Each can be disabled independently for future private inbox entries, across your organizations. A mention uses the mention preference even if you are also assigned to the task. Duplicate message retries still produce at most one entry per recipient. Existing inbox entries remain in history. Verification, password recovery and security email are unaffected; there is no nonfunctional email-notification toggle.

Saving uses an original version and a MongoDB transaction. Concurrent preference edits show a conflict and preserve the draft until **Reload notification settings** is selected. Background refetch does not replace unsaved choices. Notification delivery writes the same preference record as a transaction fence, so a concurrent saved opt-out cannot silently commit against an older preference snapshot.

## Organization administration

Owners/admins open **Administration** at `/app/organizations/<organizationId>/administration`. Members, guests and project managers cannot read these administration endpoints. Administrative rights do not grant search access to unjoined workspaces. Existing settings, Team & access, Billing and Account & security remain linked from this page.

**Usage** displays actual counts of organization memberships, workspaces, non-deleted projects, archived projects, non-deleted task/document rows, ready files/bytes and enabled AI workflows. Counts include retained archived work; they are current database measurements rather than estimates or demo values. Pending/deleted files and provider storage overhead are excluded. Billing continues to enforce plan ceilings separately. Use **Refresh usage** for a fresh measurement.

**Audit log** displays descending 25-row pages with an optional category filter. Records begin when Phase 13 hooks are deployed; no earlier history is fabricated. Local organization/workspace, team invitation/membership/ownership, project/task/planning/document/collaboration and integration changes append metadata within the mutation transaction. Billing appends checkout/portal creation and plan/status/cancellation synchronization records. A failed transaction rolls back its audit entry. Failed requests are not presented as successful changes.

Each record retains the actor identifier (or provider/system), category, action, resource identifier and time. Project activity points to the project identifier; private task/document titles, message bodies, invitation email/token, password/session values, provider URLs and payment information are excluded. Organization administrators may review organization-wide audit metadata without reading workspace content. Records expire after 180 days; reads exclude expired rows before MongoDB's asynchronous TTL cleanup. There is no application edit/delete endpoint. These are application-level append-only logs, not a tamper-proof or compliance-certified ledger; a database administrator can modify database records.

## Calendar integration

An owner/admin must first enable **Allow authenticated calendar export** in Administration → Integrations and save the versioned settings. Conflicting edits preserve the original choice and offer explicit reload. Enabling does not contact or publish to any external service.

Open an authorized project or task and choose **Export calendar**. Review the inclusive date window and select **Download calendar file**. The server requires a current cookie session and project grant, rechecks access and the enabled state before returning bytes, and returns a private `text/calendar` attachment with `no-store`. There is no public feed, bearer token in a URL or background synchronization. Guests with explicit project access can download when the organization has enabled it.

The file contains task titles, all-day due dates, stable task UIDs, version and modification timestamps. Undated/deleted tasks and task bodies/assignees/emails are excluded. The exclusive event end date is the following day, including month/year rollover. Text delimiters/newlines are escaped, UTF-8 physical lines fold at 75 octets without splitting code points, and output uses CRLF. There are no invitation attendees or meeting-request messages. See [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) for the file format.

A window is at most 366 days and 2,000 dated tasks. Larger results fail explicitly rather than truncate. A deadline of 9999-12-31 requires a smaller supported window because its exclusive end date cannot fit the export's four-digit year format. Downloaded files contain private titles: import them into a calendar you trust. Reimport/update behavior depends on that calendar and has not been verified against a hosted provider. Disabling blocks future downloads; previously downloaded files cannot be recalled. A canceled dialog or navigation aborts a pending download.

## Local verification and limits

Run static checks/builds before browser suites. With the documented native fixture or Compose services running, use:

```sh
pnpm test:administration:integration
pnpm test:administration:e2e
```

The integration suite creates a uniquely named loopback test database, uses real cookie/CSRF sessions and MongoDB transactions, then drops only its own database. Browser tests create synthetic accounts/resources in the existing isolated test fixture and clean their exact identifiers. Never rebuild contracts while browser tests are running: that reloads the development API/Vite graph. Full `pnpm test:auth:compose` appends both new suites in CI.

Normal development remains API 4000 / web 5173; the native fixture is API 4001 / web 5174. No new secrets are needed in `.env.local`; calendar configuration and notification choices live in MongoDB. Live Stripe sandbox verification and local Windows Docker/WSL/named-volume restart acceptance remain deferred. Llama stays unloaded. Phase 14 hardening/deployment has not started.
