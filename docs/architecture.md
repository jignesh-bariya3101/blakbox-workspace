# Architecture

Modular monolith. One NestJS backend process, one frontend, PostgreSQL, MinIO.

Product behavior lives in `docs/product-decisions.md`. This document describes how the code is structured so those decisions stay enforceable and explainable.

The original technology note listed Fastify. The implementation uses **NestJS** (Express adapter) so the API is organized as Nest modules/controllers/providers — the same modular monolith, not extra services. Zod still validates input. Prisma still owns the database.

No microservices, Redis, queues, Python, Kubernetes, Kafka, or Terraform.

---

## Repository layout

```
/server
  src/
    main.ts                # Nest bootstrap
    app.module.ts
    config.ts              # Zod env validation, fail-fast
    common/                # errors, request id, exception filter, tokens
    prisma/
    health/
    auth/
    users/
    workspaces/
    documents/
    storage/               # StorageProvider, MinIO/S3, memory driver, cleanup
    invitations/            # create, replace, revoke, accept
    share-links/            # create, revoke, public token download
    audit/                 # append-only workspace events, OWNER/ADMIN list
  prisma/
  test/
/client                    # React + Vite, talks to /api/v1
/docs
docker-compose.yml         # backend, frontend, postgres, minio
docs/local-setup.md        # clone → docker compose up --build
```

Nest modules are folders, not deployable services. Controllers stay thin. Services own use cases. Guards own authentication. A later `AuthzService` owns the permission matrix. Controllers never call Prisma or MinIO directly.

---

## Layers

Only five layers. Each exists because a rule would otherwise leak into the wrong place.

### Route / controller (Nest controllers)

HTTP only: parse params, validate body with Zod, read the session user from the auth guard, call one service method, map the result to status codes.

No permission math, no Prisma, no storage SDK.

### Application / service

One function per use case (`login`, `createWorkspace`, `acceptInvitation`, `uploadDocument`, …).

Owns transaction boundaries, the order of database vs storage work, and audit writes.

### Domain

Small, framework-free functions. Not a DDD kit.

- `can(role, permission)` and extra rules (cannot remove OWNER, cannot leave as OWNER)
- token generate / hash
- filename sanitization
- MIME + extension allowlist
- share-link expiry window (default 7d, max 30d)

If a rule needs a database row, it is not domain code; it belongs in a service.

### Repository / data access

Prisma queries and transactions. Repositories return data. They do not decide 403 vs 404.

Cross-workspace safety is not "the repository is trusted." Services load a resource **and** the caller's membership, then authorize. Repositories still take `workspaceId` on every workspace-scoped query so a missing `where` is harder.

### Infrastructure

- `StorageProvider` with `upload`, `download`, `delete`, `exists` (no presigned URLs)
- in-memory driver for tests / local work without MinIO (`STORAGE_DRIVER=memory`)
- Nest middleware/guards: cookie-parser, Throttler, request id, exception filter
- config, logger
- in-process cleanup interval

`StorageProvider` is the one storage abstraction we need. It is not a generic ports-and-adapters framework. There is an S3-compatible implementation (MinIO locally) plus a memory driver for tests. Credentials stay on the server.

---

## Module boundaries

| Module | Owns | May call |
|---|---|---|
| **auth** | register, login, logout, session cookie, session table | users |
| **users** | user records, password hash | — |
| **workspaces** | create, get, rename, soft-delete, transfer ownership | memberships, documents (for cleanup keys), invitations, audit, storage cleanup |
| **memberships** | add/remove/leave, role changes, membership lookup | share-links (revoke), invitations (revoke pending), audit |
| **invitations** | create, replace, revoke, accept | memberships, users, audit |
| **documents** | upload, list, get, rename, delete, member download | storage, share-links (revoke on delete), audit |
| **storage** | object keys, MinIO, cleanup jobs + retry loop | — |
| **share-links** | create, revoke, public download | documents, storage, audit |
| **audit** | append + list (OWNER/ADMIN) | — |
| **authz** | matrix and `requireMembership` / `requirePermission` / `requireOwnOrPermission` | memberships (read) |

Authorization is centralized in `authz`. Services call it. Routes do not re-implement the matrix.

---

## Runtime shape

```
Browser  -->  client (Vite :5173 / nginx :8080)
         +-->  server (NestJS :3000)  [CORS, credentials]
                              |-- PostgreSQL (Prisma)
                              |-- MinIO (StorageProvider)
                              +-- in-process cleanup
```

The UI calls `VITE_API_BASE_URL` (default `http://127.0.0.1:3000`). There is no Vite or nginx API proxy. Use the same hostname for the page and the API so the session cookie is sent.

---

## Cross-cutting

### API versioning

All application routes are under `/api/v1`. Health is `/health` (liveness) and `/ready` (Postgres + MinIO checks). Breaking changes get `/api/v2`; we do not invent a compatibility layer now.

### Configuration

`config.ts` reads environment variables, validates with Zod at process start, and exits on invalid config. Compose sets the running values. `.env.example` lists every variable with local placeholders (not production secrets). See `docs/local-setup.md`.

### Request IDs

Every request gets an `x-request-id` (incoming or generated). It is logged on every line for that request and returned on every response, including errors.

### Logging

Structured JSON logs: level, message, request id, user id (if any), workspace id (if any), route.

Never log: passwords, session tokens, invite tokens, share tokens, cookies, authorization headers, file bytes.

### Error handling

Nest `HttpExceptionFilter` maps domain errors. Oversized uploads are 413, not 400.

| Class | HTTP | Client body |
|---|---|---|
| `ValidationError` | 400 | field errors (details only outside production) |
| `UnauthorizedError` | 401 | generic |
| `ForbiddenError` | 403 | generic (member, missing permission) |
| `NotFoundError` | 404 | generic |
| `ConflictError` | 409 | generic (duplicate membership, etc.) |
| `PayloadTooLargeError` | 413 | oversized upload |
| `RateLimitError` | 429 | generic |
| everything else | 500 | generic; stack only in logs |

Shape: `{ error: { code, message }, requestId }`. No Prisma or Node stack traces in production-style responses.

### Rate limiting

In-process Nest throttling (no Redis). Keys are `name:<ip>`. `X-Forwarded-For` is ignored so clients cannot mint a new bucket. When `TRUST_PROXY=true` (only if a trusted reverse proxy sits in front of the API), the key uses the single `X-Real-IP` value that proxy sets from `$remote_addr`. Compose does not proxy the API, so `TRUST_PROXY=false` and the key is `socket.remoteAddress`. Limits (per IP, 60s): register/login/invite accept 10; public share download 30. Over limit is 429 `{ error: { code: "rate_limited" } }` plus `Retry-After: 60`. Single-process only.

---

## Authorization flow (every member route)

1. Session plugin: cookie → hash → session row → user. Else 401.
2. Service loads workspace where `deleted_at IS NULL`.
3. `requireMembership(userId, workspaceId)` → 404 if none.
4. `requirePermission(role, permission)` or own-resource check → 403 if denied.
5. Resource query includes `workspaceId` (and `deleted_at IS NULL` where relevant).

Public share routes skip steps 1–4 and use token checks instead.

---

## Request flows

For each flow: who is authenticated, who is authorized, where the transaction starts and ends, what touches the database, what touches storage, and what happens on failure.

### 1. Login

- **Auth:** none (public). Rate limited.
- **Authz:** none.
- **Transaction:** single insert of the session row after password verify.
- **DB:** lookup user by email; compare Argon2id; insert `sessions` (token hash, expiry).
- **Storage:** none.
- **Failure:** unknown email and bad password return the same 401. Timing is not perfectly equalized beyond "always hash if a user exists"; we do not add dummy-hash complexity unless it stays one line. Cookie is set only after the session insert succeeds.

### 2. Create workspace

- **Auth:** session required.
- **Authz:** any authenticated user.
- **Transaction:** create `workspaces` + `workspace_members` (role OWNER) + audit `workspace.created`.
- **DB:** those three writes.
- **Storage:** none.
- **Failure:** if the transaction rolls back, nothing is created. No storage to compensate.

### 3. Invite member

- **Auth:** session required.
- **Authz:** membership + `invite` permission (OWNER or ADMIN). 404 if not a member; 403 if MEMBER.
- **Transaction:** if a pending invite exists for `(workspace, email)`, mark it `replaced`; insert new pending invite (token hash, expiry 7d, inviter id); audit `member.invited`.
- **DB:** invitation + audit. Reject if the email is already a member (409).
- **Storage:** none.
- **Failure:** rollback leaves the old pending invite untouched. Raw token is returned only after commit. Never persisted.

### 4. Accept invitation

- **Auth:** session required. Rate limited. Separate from registration.
- **Authz:** no workspace membership yet. Checks: token hash, status `pending`, `expires_at` in the future, workspace not deleted, session email equals invite email.
- **Transaction:** insert membership (MEMBER) + set invitation `accepted` + audit `member.invite_accepted`.
- **DB:** those writes. Unique `(workspace_id, user_id)` is the concurrency backstop.
- **Storage:** none.
- **Failure:** wrong email / expired / replaced / revoked / deleted workspace → 404-style generic accept error (do not leak workspace details). Unique-violation → treat as already accepted / already a member (409). Inviter role is **not** re-checked.

### 5. Upload document

- **Auth:** session required.
- **Authz:** membership + `upload` (all roles).
- **Transaction 1:** insert `documents` (`pending`, storage key, metadata).
- **Storage:** `StorageProvider.upload` of the stream (size cap 25 MiB).
- **Transaction 2:** set `status = ready` + audit `document.uploaded`.
- **Failure:**
  - validation (type/size) → 400, no row, no object.
  - upload fails after pending insert → do not promote; best-effort `storage.delete`; if that delete fails, enqueue a cleanup job **without** `document_id` so the pending row can still be removed (FK is RESTRICT). Client sees 500.
  - ready-update fails after upload → best-effort `storage.delete`; if that fails and DB is up, enqueue a cleanup job without `document_id`; pending row stays unlisted until the 15-minute sweeper.

Cleanup loop later removes pending rows older than 15 minutes.

### 6. Download document (member)

- **Auth:** session required.
- **Authz:** membership + `download`; document `ready` and not deleted, same workspace. Else 404.
- **Transaction:** none required. Audit `document.downloaded` can be a separate insert (failure of audit must not fail the download; log and continue).
- **DB:** membership + document lookup; audit insert.
- **Storage:** `downloadStream(key)` piped to the response.
- **Failure:** missing object after a ready row → 500, log, leave row (human can delete). Do not invent a new status.

### 7. Create share link

- **Auth:** session required.
- **Authz:** membership + `create share link`; document ready and not deleted.
- **Transaction:** insert `share_links` (token hash, expiry clamped to default/max) + audit `share_link.created`.
- **DB:** those writes.
- **Storage:** none.
- **Failure:** rollback; raw token never returned. Token is returned once in the JSON body after commit.

### 8. Access share link (public download)

- **Auth:** none. Rate limited.
- **Authz:** token checks only (see product decisions section 6). No session.
- **Transaction:** optional increment of `download_count` (lost updates OK) + audit `share_link.downloaded` with null actor.
- **DB:** lookup by token hash joined to document and workspace; increment; audit.
- **Storage:** `downloadStream` after checks pass.
- **Failure:** any failed check → same generic not-found. Do not increment or audit until the object stream is opened. In-flight streams may finish if revoke/delete happens after checks.

### 9. Revoke share link

- **Auth:** session required.
- **Authz:** membership; creator may revoke own; ADMIN/OWNER may revoke any. Missing membership or other-workspace id → 404. Member revoking someone else's → 403.
- **Transaction:** set `revoked_at` if still null + audit `share_link.revoked`.
- **DB:** those writes.
- **Storage:** none.
- **Failure:** already revoked or expired still 404/idempotent-not-found for a MEMBER who cannot see it; OWNER/ADMIN may see it as already revoked (409 or no-op). Choose **no-op success if already revoked and caller could have revoked it**; otherwise 404. Keeps retries simple.

### 10. Delete document

- **Auth:** session required.
- **Authz:** membership; own document **or** ADMIN/OWNER. Else 403. Wrong workspace → 404.
- **Transaction:** set `deleted_at`; revoke active share links; insert `storage_cleanup_jobs`; audit `document.deleted`.
- **DB:** those writes. Commit **before** storage delete.
- **Storage:** after commit, `delete(key)`. On success, mark job done. On failure, job remains for the loop.
- **Failure:** transaction failure → document still visible, no revoke, no job. Storage failure → document already gone from the API.

### 11. Remove workspace member

- **Auth:** session required.
- **Authz:**
  - self-leave: ADMIN or MEMBER (OWNER → 403)
  - remove other: OWNER can remove ADMIN/MEMBER; ADMIN can remove MEMBER only
  - cannot remove OWNER
- **Transaction:** delete membership row; revoke that user's share links in this workspace; revoke their pending invitations; audit `member.removed` or `member.left`.
- **DB:** those writes.
- **Storage:** none. Documents stay.
- **Failure:** rollback restores membership (access remains). Session of the removed user is not revoked.

---

## Storage consistency

PostgreSQL and MinIO do not share a transaction.

| Outcome | Application truth | Repair |
|---|---|---|
| DB pending + storage missing | not listed | delete pending row |
| DB ready + storage missing | listed, download 500 | operator/user deletes the document |
| DB deleted + storage present | not listed, links dead | cleanup job retries delete |
| storage present + no DB row | orphan | only if we still know the key; else accept rare leak |

The cleanup loop is a `setInterval` in the backend process. It is not BullMQ, Redis, or a worker service. There is no Redis in this system.

### Failure scenarios

PostgreSQL and MinIO are separate systems. There is no distributed transaction.

| Scenario | Current behavior | Safe? | Notes |
|---|---|---|---|
| Upload failure (storage PUT) | Pending row discarded; object delete or cleanup job (no `document_id`) | Yes | Client may retry and create a second document. |
| Delete failure (storage DELETE) | DB already soft-deleted + links revoked; job retries | Yes | API truth is the database. |
| Database failure | In-flight HTTP fails; committed work stays; uncommitted rolls back | Yes | Pending rows older than 15m are swept. |
| Storage failure mid-download | 500; ready row left for a human delete | Yes | Do not invent a `failed` status. |
| Network timeout | Client retry is a **new** upload/invite | Trade-off | No idempotency keys in take-home scope. |
| Duplicate / retry delete | Second delete is 404 (row already `deleted_at`) | Acceptable | Looks like failure to the client after success. |
| Concurrent transfer / invite create | Partial unique OWNER / one pending invite | Yes | Second writer retries or conflicts. |
| Expired share during access | Expiry checked before opening the stream | Trade-off | An in-flight stream may finish after expiry. |
| Member removed during access | Authz at request start | Trade-off | In-flight download may finish; next request is 404. |
| Document deleted during download | Same | Trade-off | Product decision: stream may finish; object delete can cut it short. |
| Duplicate invitation | Previous pending marked `replaced` | Yes | Newest token wins. |
| Concurrent invitation accept | `pending` → `accepted` + unique membership | Yes | One membership row. |

Public share increments `download_count` only after the object stream is opened. Audit on that path is best-effort.

Unavoidable orphans: if we lose the storage key **and** the database in the same incident, we will not sweep the bucket. That would require a full listing and is easy to get wrong.

| Policy | Value |
|---|---|
| Interval | 60s |
| Batch | 25 incomplete jobs (`completed_at` null, `attempts` < 8) |
| Backoff | `30s * 2^(attempts-1)`, capped at 15 minutes; attempt 0 is immediate |
| Max attempts | 8; then the row stays open with `last_error` for an operator |
| Idempotency | object `delete` is safe to repeat; `markDone` only after a successful delete |
| Failures | logged; the request path already committed DB truth (soft-delete / pending removed) |

---

## Testing boundaries

Prefer integration tests against a real Postgres (and MinIO where the test is about objects).

| Layer | Test how |
|---|---|
| Domain (`can`, token hash, MIME allowlist) | unit tests |
| Auth, invitations, share links, IDOR | API integration tests |
| Constraints (unique membership, unique token hash) | DB integration tests |
| Upload/delete split-brain | integration with MinIO or a fake `StorageProvider` in-process |
| Frontend | unit tests for `safeNext`, permission UX helpers, and API error mapping |

Do not mock Prisma for authorization tests. Those tests exist to catch missing `workspaceId` filters.

---

## Frontend (brief)

React + Vite + TypeScript. React Router, TanStack Query, React Hook Form, Zod.

The UI is a client of `/api/v1`. It may hide buttons the role cannot use. It never decides access.

Pages we expect: sign in / register, workspace list, workspace (members, invites, documents), document detail, accept-invite, public share download.

No design system, no extra state library.

---

## What we are not adding

- A service mesh, message bus, or worker container
- A generic repository base class
- A unit-of-work framework beyond `prisma.$transaction`
- Presigned URLs
- Python scanners
- Redis

If a later prompt needs one of these, the reason goes in this file first.
