# Phase 9 — documents and files

Date: 14 October 2026. [Scope](PHASE9_PLAN.md), [gallery](SCREENSHOTS.md).

Implementation adds shared project documents with safe rich text, immutable versions/history, explicit restore, original-version conflicts and live draft preservation. Private project/task/subtask/document files support validated uploads up to 8 MiB, real image/text/PDF previews, download, rename, removal, literal search and bounded paging. Current tenant/resource membership protects every operation; guests/archives read only. Removed/revoked parents hide retained content immediately.

MongoDB records and activity commit transactionally. Actual private disk/S3 adapters persist bytes; durable pending intents, SHA-256 fingerprints and UUIDs recover upload failures without duplicate served metadata/events. Logical removal precedes physical cleanup. A bounded CLI handles deleted, expired and orphaned objects. Production requires private S3; development uses ignored private disk data. Tiptap 3.32.0/PDF.js 6.4.299 are pinned, peer-compatible and lazy; PDF assets are self-hosted. [Tiptap documentation](https://tiptap.dev/docs/editor/getting-started/install/react), [AWS private object API](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/PutObjectCommand/), [PDF.js releases](https://github.com/mozilla/pdf.js/releases).

## Executed verification

Strict types, lint, formatting and production build passed. All **177** unit/component/API tests passed in **27** files. The actual MongoDB/private disk integration driver passed **27** checks: safe contracts, identity/scope, immutable saves/restore, retries, rollback, binary Origin/CSRF/size validation, private checksummed bytes, original rename/remove versions, pending put/finalization failures, logical deletion before cleanup, orphan reconciliation, new adapter/connection durability, revocation during I/O, archives, deleted parents, real file pagination and concurrent retry deduplication.

All five document browser scenarios passed directly, without retries. They cover actual editor formats/links, immutable history/restore, real private image/text/PDF previews, download byte equality, project/document/task attachments, search/paging, stale drafts and explicit reload, guests/archives, live revocation, unconfirmed uploads and unavailable preview retry. Twelve page/dialog families passed **72** axe scans with zero violations across dark/light at 375/768/1440px, including keyboard containment/restoration, overflow and reduced motion. Happy-path console/runtime errors were absent. All 72 captures are retained; the gallery now contains 435 PNGs. Desktop dark and mobile light captures were visually inspected.

Earlier-phase regression and GitHub publication verification are in progress. No unexecuted check is counted as passed.

Diagnostic runs found a cleanup type mismatch, an older production environment test missing S3 configuration, missing overlay focus restoration, a nested link submit reaching its parent document form, pinned editor link/list attributes missing from the strict contract, and an ambiguous implicit select label. All were corrected and verified. Vite prebundles lazy editor dependencies to prevent first-use page reloads; history loads only when opened. Generated PDF assets are excluded from source lint/format checks. Pagination resets only its uniquely owned synthetic actors' library rate buckets; production limits remain enforced. Failed diagnostic attempts are not additional passing checks.

Executed commands: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm test:documents:integration`, `pnpm test:documents:e2e`. The sequential earlier-phase run uses the same integration/browser command families documented in [TESTING.md](TESTING.md), plus `node scripts/check-production.mjs`. Publication audits check staged credentials, generated artifacts, local links and screenshots before pushing.

## Boundaries and recovery

Windows Docker/WSL and container-restart acceptance remain deferred at the user's request. Local fixture MongoDB 8.3.4/Mailpit 1.27.10 and private disk checks are separate from remote Compose/Garage evidence. After installing prerequisites and resolving ports, run `pnpm setup`, `pnpm infra:up`, `pnpm infra:check`, `pnpm test:auth:compose`, then the named-volume restart sentinel in [TESTING.md](TESTING.md). Preserve volumes. No deployment, paid service, system prerequisite installation or business-data seed. Phase 10 is not started.

Preview: [local app](http://127.0.0.1:5174/app), then an authorized project → Documents & files. No synthetic test project is left in your account.
