# BlakBox

Weekend take-home: a small workspace file store. People register, create workspaces, upload documents, invite others, and share time-limited download links.

The brief left roles, expiry, invites, and delete semantics open. Those choices are in `docs/product-decisions.md` and match the running code.

Stack: NestJS (`/api/v1`), React + Vite, PostgreSQL, MinIO. No Redis, queue, or mailer.

## Run (Docker)

You need Docker Desktop or Docker Engine with Compose v2 (Windows, macOS, or Linux). You do not copy `.env` files for this path. Folders are `server` and `client` on every OS.
docker compose up --build

Open **http://127.0.0.1:8080** (use `127.0.0.1`, not `localhost`). Register an account; there is no seed user.

The browser calls **http://127.0.0.1:3000**. On start, the API runs `prisma migrate deploy`. Data lives in Docker volumes `postgres_data` and `minio_data`. Stop with `docker compose down`. Backup and wipe: `docs/local-setup.md`.

Without Docker: `docs/local-setup.md` section B.

## Layou
server/             Nest API, Prisma, integration tests
client/             React UI
docker/backend.env  Compose API config
docs/               decisions, architecture, database, setup, audit write-up
docker-compose.yml

## Architecture

One API process, one UI origin. Controllers parse HTTP; services own transactions and authz. Prisma talks to PostgreSQL. File bytes go to MinIO/S3 through `StorageProvider`. Leftover objects are cleaned by an in-process interval.

The UI calls the API URL with cookies (`credentials: include`). CORS is an allowlist. Open the UI on the same hostname as the API (`127.0.0.1` vs `localhost` are different cookie sites).

A common stack list named Fastify. This repo uses NestJS (Express adapter) so modules stay explicit. Zod still validates input.

More detail: `docs/architecture.md`.

## Assumptions (short)
Auth : Email + password, Argon2id. Opaque session token in an httpOnly, SameSite=Lax cookie. Only SHA-256 of the token is stored. 7 days, no sliding refresh. Logout revokes that session. No email verification or password reset (no mailer). |
Roles: OWNER, ADMIN, MEMBER. Creator is OWNER. One OWNER per workspace (partial unique index). Owner cannot leave; they transfer to any current member or delete the workspace. |
Shares: Capability URL. 32 random bytes, hashed at rest. Default 7 days, max 30. Download streams through the API. Expired, revoked, and deleted cases return the same public not-found. |
Invites: No email. API returns the token once. Accept needs a session whose email matches. Register does not auto-join. One pending invite per workspace+email. |
Delete: Documents and workspaces: soft-delete. Membership: hard-delete. Their share links and pending invites in that workspace are revoked. Files they uploaded stay. |
Extra: Workspace audit trail for OWNER/ADMIN. Why this and not versioning or AV: `docs/product-improvement.md`. |

## Authorization

The API is the authority. The UI only hides buttons.

Not a member, or the workspace/document is gone → **404**. Member without that permission → **403**.

Every member can view, upload, and download ready files. MEMBER can change only their own files and links. ADMIN can invite, remove MEMBERs, and manage other people’s files/links. OWNER can change roles, remove ADMINs, transfer ownership, and delete the workspace.

## Storage

Postgres holds metadata and hashed tokens. Bytes are never in Postgres. Object keys are `workspaces/{workspaceId}/documents/{documentId}/{random}`, not the filename. Cap 25 MiB. Allowlist: pdf, png, jpg/jpeg, gif, webp, txt, csv, docx, xlsx (extension, MIME, and content must agree).

## Database

Tables: `users`, `sessions`, `workspaces`, `workspace_members`, `workspace_invitations`, `documents`, `share_links`, `audit_events`, `storage_cleanup_jobs`.

Indexes that match real queries: email, session hash, `(workspace_id, user_id)`, invite/share hashes, ready document list, audit list, cleanup jobs. Partial uniques: one OWNER; one pending invite per workspace+email.

Schema notes: `docs/database.md`.

## Security

- Session cookie httpOnly + SameSite=Lax. `Secure` follows `COOKIE_SECURE` (Compose HTTP sets it false).
- Passwords Argon2id; tokens SHA-256. Invite lookup is POST body, not a query string.
- Rate limits on register, login, invite accept, and public share (in-process, per IP).
- CORS allowlist + credentials. `X-Forwarded-For` is ignored.
- Uploads: allowlist + magic-byte checks; 413 over 25 MiB.
- Downloads: `Content-Disposition: attachment`, `nosniff`.

Not built: CSRF tokens (Lax + same-site host instead), MFA, virus scan, account lockout beyond IP limits.

## Failure handling

Postgres and MinIO do not share a transaction. The database is application truth.

Upload: `pending` row, PUT object, then `ready`. Failed PUT drops the pending row and enqueues cleanup if the object might exist. Delete: soft-delete + revoke links + cleanup job, then object delete with retries. A client retry is a new upload. An in-flight download may finish after revoke or delete.

## Tests
cd server
npm test

cd client
npm test

API tests hit real Postgres (`STORAGE_DRIVER=memory`). They cover auth, IDOR, roles, invite accept (including concurrent), upload/download/delete, share expire/revoke, storage failure, and constraints.

UI unit tests cover `?next=` after login, permission helpers, and error mapping. Browser script: `cd client` then `npm run test:e2e` (API on:3000, Vite on:5173).

## Trade-offs and limits

Left out on purpose: password reset, SSO, outbound email, Redis, BullMQ, Python, folders, search, quotas, presigned URLs, document restore.

Python is in the job description. It is not in this repo. There is no isolated processing job that needs a second language.

Next: HTTPS + `Secure` cookies; a real mailer for invites; optional presigned GET after the share token is checked.

## Agent use

I used Cursor while building this. Product decisions were written first and treated as the contract. I reviewed authz (404 vs 403), hashed tokens, "no files in Postgres," and the test suite myself. I can explain the codebase, the features, and what we would add next.
