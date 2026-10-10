# API

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

No invitations, membership-management, ownership-transfer, delete/archive, project, or task routes exist yet. Switching uses the normal authorized resource GETs; no client-selected identifier grants access.

## Logging

Requests log their ID, method, status, and duration. Bodies, query strings, authorization headers, cookies, and connection URIs are not logged by request middleware. Known sensitive structured fields are redacted by the logger. Dependency failures use generic development diagnostics, not raw connection exceptions. Log level is environment-controlled.
