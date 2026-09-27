# Product improvement: workspace audit trail

The assignment asks for one thing a real user would want next. The choice is **audit trail**. It is implemented (API, `audit_events`, OWNER/ADMIN UI, tests). This document is the written case for that choice, not a second feature.

## Problem

Workspaces share files and capability URLs. After someone is invited, removed, or a link is created, owners have no durable record of who did what. Support and trust both fail if the only history is “look at who is a member now.”

## User

The workspace OWNER (and ADMIN they trust). They need to answer: who uploaded this file, who created that share link, when did this person leave, did a public download happen after we revoked the link.

A MEMBER does not get this list. Public share users do not get it.

## Current limitation

Membership rows are hard-deleted. Soft-deleted documents stay in the table but are hidden from list/get. Share tokens are hashed; the raw token is gone after create. Without an append-only log, those facts disappear from the product surface even though the files and memberships still exist.

## Proposed behavior (implemented)

Workspace-scoped events are written in the same transaction as the mutating work, except downloads: `document.downloaded` and `share_link.downloaded` use a best-effort insert so a failed audit row does not fail an already-authorized stream.

Recorded actions:

- `workspace.created` / `workspace.deleted` / `workspace.ownership_transferred`
- `member.invited` / `member.invite_revoked` / `member.invite_accepted`
- `member.removed` / `member.left` / `member.role_changed`
- `document.uploaded` / `document.renamed` / `document.deleted` / `document.downloaded`
- `share_link.created` / `share_link.revoked` / `share_link.downloaded`

Each row: workspace id, actor user id (null for public share downloads), action, resource type/id, request id, timestamp, small JSON metadata (filename, role). Never stored: passwords, session/share/invite tokens, hashes, authorization headers, object keys, file bytes.

Rows are append-only. OWNER and ADMIN list them with keyset pagination (`limit`, `cursor`). MEMBER gets 403. Missing membership is 404. Login success/failure is not recorded here (no workspace, and a failed-login list is an enumeration aid).

No filters, export, retention UI, or “audit as a permission override.”

## API impact

`GET /api/v1/workspaces/:workspaceId/audit` (session cookie). Query: `limit` 1–50 (default 20), optional UUID `cursor`. Response: `{ events, nextCursor }`. Same 404/403 rules as other workspace reads. Public share download does not expose this route.

Writes are not a public API. Services call `AuditService.write` (or `tryWrite` for downloads).

## Database impact

Table `audit_events`: UUID id, `workspace_id`, nullable `actor_user_id`, `action`, `resource_type`, nullable `resource_id`, `request_id`, `metadata` JSON, `created_at`. FKs to workspace and actor with `ON DELETE RESTRICT` so history is not cascade-wiped. Index `(workspace_id, created_at DESC, id DESC)` matches list order.

No new queue, no new store. Volume is one row per mutating action plus optional download rows.

## Security impact

Audit is not an authorization bypass. Listing uses `Permission.auditView` (OWNER/ADMIN). Cross-workspace ids stay 404.

Metadata keys matching `token|password|secret|authorization|cookie|hash` are stripped before insert. Tests assert listed JSON does not contain raw share tokens or storage keys.

Public share download events have a null actor. That is intentional: the downloader is unauthenticated.

Failed login is omitted on purpose. A workspace owner must not be able to use this table to probe emails.

## Operational impact

Writes ride the existing Postgres transaction. Downloads that skip a failed audit log a warning and still serve the file. There is no extra process, Redis, or disk. Retention is unbounded in this assignment; a later job could delete rows older than N days without changing the API.

## Failure cases

| Case | Behavior |
|---|---|
| Mutating transaction rolls back | Audit row is not committed. |
| Download succeeds, audit insert fails | File is still sent; warning logged. |
| MEMBER or outsider lists audit | 403 or 404; no events. |
| Cursor id not in this workspace | Empty page, not another workspace’s events. |
| Actor user later deleted | Blocked by FK until that is designed; users are not deleted in this product. |
| Workspace hard-deleted | Blocked by FK; workspaces are soft-deleted. |

## Why this feature was selected

A real owner needs history after invites, removals, and share links. The assignment is scored on authorization and security; an audit table is the same kind of work (who can see what, what is stored). It fits in PostgreSQL next to membership and documents. It does not add Redis, a worker, another language, or a fake mailer.

## Why other candidate features were not selected

| Candidate | Why not |
|---|---|
| Versioning | Extra objects, restore vs soft-delete, and easy-to-get-wrong cleanup. |
| Password-protected links | Extra secret, UX, and rate-limit surface on a capability URL that is already sensitive. |
| Quotas | Aggregation and enforcement on every upload; not the scoring center. |
| Folders | Tree moves and rename edge cases; mostly UI. |
| Virus scanning | Typically a queue and another runtime. |
| Search | Indexing and ranking; not needed to show authz or storage. |
| Notifications | Fake without email or a realtime channel. |

Only this improvement is in the product. See `docs/product-decisions.md` section 12.
