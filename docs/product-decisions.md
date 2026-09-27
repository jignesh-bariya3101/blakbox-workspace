# Product decisions

This document records the product and engineering decisions for the take-home assignment.

The assignment brief is intentionally incomplete. Each section picks one behavior and explains why. These decisions are the source of truth for later implementation.

Scope target: a small document-sharing product with production-minded security, not an enterprise platform.

---

## 1. Authentication

| Topic | Decision |
|---|---|
| Registration | Email + password. Email is stored lowercase and trimmed. Password minimum 8 characters. Account is usable immediately. No email verification. |
| Login | Same email + password. Success creates a server-side session. Failure returns the same generic error as a bad password. |
| Logout | Current session is revoked immediately. Other sessions stay valid. |
| Session strategy | Opaque session token (32 random bytes). Raw token is sent as an httpOnly, Secure, SameSite=Lax cookie. Only a SHA-256 hash of the token is stored in PostgreSQL, with `expires_at` and `revoked_at`. Session lifetime is 7 days. No sliding refresh. |
| CSRF | The UI and API are different origins. The browser calls the API URL with `credentials: include`. SameSite=Lax still blocks cross-site cookie sends. CORS is an allowlist (`CORS_ORIGINS`), not `*`. Open the UI on the same hostname as `VITE_API_BASE_URL` (`127.0.0.1` vs `localhost` are different cookie hosts). No CSRF-token library. |
| Password hashing | Argon2id. Never store or log plaintext passwords. |
| Duplicate email | Registration returns a generic failure. Do not confirm whether the email already exists. |
| Unauthenticated access | Allowed only for: register, login, health checks, and public share-link routes. Everything else requires a valid session. |
| Rate limits | In-process limits on register, login, invitation accept, and public share access. No Redis. |
| Password reset | Out of scope. |

Why sessions instead of JWT: logout and revocation are real, without a denylist or extra store. PostgreSQL already holds user state; a `sessions` table is enough.

Why no email verification or password reset: both need outbound email. For a weekend take-home, inventing a mail provider would be fake production. Invite links are returned by the API so the flow can still be demonstrated.

---

## 2. Workspace

| Topic | Decision |
|---|---|
| Who can create a workspace | Any authenticated user. The creator becomes OWNER. |
| Multiple workspaces | Yes. A user can own or join many workspaces. |
| Ownership | Exactly one OWNER per workspace. Ownership is the membership role `OWNER`, not a second column on `workspaces`. |
| Workspace deletion | OWNER only. Soft-delete the workspace (`deleted_at`). After commit, membership, invitation, document, and share-link access for that workspace fails. Object-storage cleanup is queued for that workspace's object keys. |
| Owner leaving | The OWNER cannot leave or be removed. They transfer ownership to any other current member (that member becomes OWNER; the previous owner becomes ADMIN), or they delete the workspace. |
| Self-leave | ADMIN and MEMBER may leave. Treated as membership removal of themselves (section 9). |
| Membership | Created by accepting an invitation, or automatically when the workspace is created. At most one membership row per `(workspace_id, user_id)`. Membership rows are hard-deleted on leave or removal. History lives in audit, not in a soft-deleted membership. |

Why one owner: someone must always be able to delete the workspace and transfer control.

Why transfer to any member, not only an ADMIN: requiring an ADMIN first creates a dead end in a one-person workspace that later added a single MEMBER.

Why soft-delete the workspace: pending invites and old URLs must fail cleanly, and storage cleanup can retry after the database commit.

---

## 3. Workspace roles

Three roles: `OWNER`, `ADMIN`, `MEMBER`.

This is enough to show authorization without a custom permission editor.

Why this split:

- MEMBER is a collaborator: they work with documents, including sharing files they can see.
- ADMIN runs the workspace day to day: invites, removals of MEMBERs, and document/share-link administration.
- OWNER is the only person who can destroy the workspace, change admin-level roles, or transfer ownership.

Trust boundary: a workspace member can already download every document. Share links are an unauthenticated distribution path, but blocking MEMBERs from creating them would not stop exfiltration. Who you invite is the real control. Frontend permission checks are UX only. The API is authoritative.

### Permission matrix

| Action | OWNER | ADMIN | MEMBER |
|---|---|---|---|
| View documents | yes | yes | yes |
| Upload | yes | yes | yes |
| Download | yes | yes | yes |
| Rename own document | yes | yes | yes |
| Rename another user's document | yes | yes | no |
| Delete own document | yes | yes | yes |
| Delete another user's document | yes | yes | no |
| Create share link | yes | yes | yes |
| Revoke own share link | yes | yes | yes |
| Revoke another user's share link | yes | yes | no |
| Invite users | yes | yes | no |
| Revoke invitation | yes | yes | no |
| Remove MEMBER | yes | yes | no |
| Remove ADMIN | yes | no | no |
| Leave workspace | no | yes | yes |
| Change roles (not OWNER) | yes | no | no |
| Transfer ownership | yes | no | no |
| Delete workspace | yes | no | no |

Rules that sit beside the matrix:

- There is always exactly one OWNER.
- OWNER cannot leave, be demoted, or be removed except by transferring ownership first.
- A user cannot change their own role.
- ADMIN cannot remove or demote another ADMIN.
- Transfer target must already be a member of that workspace.

### HTTP status for authorization

- **404** if the caller is not a member of the workspace, or the resource is not in a workspace they belong to (forged or cross-workspace IDs).
- **403** if the caller is a member but lacks the permission (for example a MEMBER deleting someone else's document).
- Public share-link failures are always the same generic not-found. They do not use this 403/404 split.

---

## 4. Documents

| Topic | Decision |
|---|---|
| Ownership | The uploader is recorded as `uploaded_by`. That person is the document owner for "own document" permissions. Ownership does not move when a member is removed. If they rejoin later, "own document" rules apply again. |
| Workspace relationship | Every document belongs to exactly one workspace. All member document queries are workspace-scoped. |
| Visibility | Every active member can view and download every **ready**, non-deleted document in that workspace. No per-document ACLs. |
| List/detail | Only `status = ready` and `deleted_at IS NULL`. Pending rows are not shown. |
| Rename | Changes the display filename only. The storage object key does not change. |
| Duplicate filenames | Allowed in the same workspace. Documents are identified by ID, not name. |
| Deletion | Soft delete via `deleted_at` only. See section 10. |
| Restoration | Out of scope. Soft delete exists for consistency and cleanup, not as a recycle bin. |
| Share links after deletion | All share links for that document stop working immediately. |

Why no per-document ACLs: the assignment is a workspace product. Per-file permissions would add UI and authorization complexity without changing the evaluation story.

Why duplicate names are allowed: unique filenames force rename races on concurrent uploads. IDs are the stable identity.

---

## 5. Uploads

| Topic | Decision |
|---|---|
| Maximum size | 25 MiB. Rejected before the object is written when the size is known; also enforced while streaming. |
| Allowed types | `pdf`, `png`, `jpg`/`jpeg`, `gif`, `webp`, `txt`, `csv`, `docx`, `xlsx`. Anything else is rejected. |
| Filename | Client filename is sanitized for display (strip path, control characters, max 255 chars). It is never used as the storage key. |
| MIME validation | Allowlist on declared MIME. Declared MIME must match the allowed extension. No magic-byte sniffing in this assignment. |
| Duplicate files | Same bytes may be uploaded more than once. No content-hash deduplication. |
| Upload lifecycle | 1) Authenticate and authorize. 2) Validate size, type, filename. 3) Insert document row with `status = pending`, `deleted_at` null, and a server-generated storage key. 4) Upload bytes to object storage. 5) Mark `status = ready`. |
| Status values | `pending` or `ready` only. No `failed` status and no `status = deleted`. Failed uploads delete or clean up the pending row. Soft delete uses `deleted_at`. |
| Storage upload fails | Pending row is not promoted. Cleanup deletes the pending row and any partial object. The client receives an error. |
| Database write fails after storage upload | The request handler deletes the object immediately. If that delete also fails, enqueue a cleanup job **only if** we still have a database connection and know the key. No bucket-wide orphan sweep (that needs a full listing and is easy to get wrong). Rare orphans are accepted and noted as a limitation. |
| Stale pending rows | A small in-process loop deletes `pending` rows older than 15 minutes and attempts to delete their object keys. |
| Storage key | `workspaces/{workspaceId}/documents/{documentId}/{random}` — UUIDs and a random suffix, never the user filename. |

Why 25 MiB: large enough for typical office files, small enough for a local MinIO demo without chunked multipart complexity.

Why no content dedup: two documents sharing one object makes deletion unsafe.

Why no bucket sweep: we only delete keys we recorded. That is explainable and testable.

---

## 6. Share links

A share link is a capability URL. Anyone who has the raw token can download that one document until the link expires or is revoked, or the document or workspace is deleted.

| Topic | Decision |
|---|---|
| Authentication | Not required. Public download. |
| Preview | Out of scope. Download only. |
| Expiration | Required. Caller may set `expiresAt`. |
| Default expiration | 7 days from creation. |
| Maximum expiration | 30 days from creation. |
| Manual revocation | Creator, ADMIN, or OWNER can revoke. MEMBER can revoke only links they created. |
| Repeated use | Allowed until expired or revoked. |
| Download count | Incremented when a download is authorized, before bytes are sent. Not a cap. Lost increments under concurrency are acceptable. |
| Password protection | Out of scope. |
| Recipient information | Not collected. |
| After document or workspace deletion | Link fails. Same public not-found as an invalid token. |
| Token | 32 bytes from a CSPRNG, URL-safe base64. Only SHA-256(token) is stored. Sequential IDs and document IDs are never the secret. |
| Delivery | File is streamed through the API. No presigned URL in this assignment. |
| In-flight downloads | A download that already passed checks may finish after revoke or delete. New requests fail. |

Why stream instead of a presigned URL: one path for authorization, audit, and download count; no signed URL to leak in logs or browser history. 25 MiB through the API is acceptable here. Production can switch to a short-lived presigned GET later without changing the token model.

Invalid, expired, revoked, deleted-document, and deleted-workspace cases all return the same public error.

A link is allowed only when all of these are true at request time:

- token hash matches a row
- `revoked_at` is null
- `expires_at` is in the future
- document `status = ready` and `deleted_at` is null
- workspace `deleted_at` is null

---

## 7. Expiration and access end-states

| Event | Behavior |
|---|---|
| Expired share link | Treated as not found. No download. |
| Revoked share link | Same as expired. |
| Expired invitation | Cannot be accepted. Enforced by `expires_at` at accept time. A background status flip is not required. |
| Deleted document | Hidden from members. Share links fail. Storage deletion is queued. |
| Deleted workspace | All member API access fails. Pending invitations fail. Share links for its documents fail. Storage cleanup is queued. |
| Removed or self-left member | Immediate. Their login session stays valid for other workspaces. Workspace-scoped checks fail. |

Expiration is enforced at use time by reading timestamps. A job is not required to "expire" a row before it is checked.

---

## 8. Invitations

Invitations are email-scoped credentials. The raw token is a secret. Only SHA-256(token) is stored.

**Existing account**

1. ADMIN or OWNER creates an invitation for an email.
2. API returns an invite URL containing the raw token (shown once).
3. Invitee signs in with that email (or is already signed in as that email).
4. Accept validates token, email match, expiry, pending status, and that the workspace is not deleted.
5. Membership is created in the same transaction that marks the invitation `accepted`.

**No account**

1. Same invitation is created.
2. Invitee opens the URL, registers with the invited email, then accepts in a separate step.
3. Registration does not auto-join the workspace.
4. Registration with a different email cannot accept that invitation.

| Topic | Decision |
|---|---|
| Email ownership | The signed-in user's email must equal the invitation email (case-insensitive). |
| Expiration | 7 days. Not configurable. |
| Revocation | ADMIN or OWNER can revoke a pending invitation. |
| Duplicate invitation | One pending invitation per `(workspace_id, email)`. A new invite for the same pair marks the previous pending invite `replaced` (old token dies) and creates a new pending row. |
| Already a member | Creating or accepting an invitation fails. No second membership row. |
| Wrong account | Accept fails. Do not reveal extra workspace detail. |
| Double accept | Second accept fails. Unique membership is the backstop. |
| Concurrent accept | Unique `(workspace_id, user_id)` plus a transactional status update (`pending` → `accepted`) so only one commit wins. |
| Workspace deleted | Accept fails. |
| Inviter loses permission | **Not re-checked at accept.** Authorization is evaluated when the invitation is created. If the inviter is later removed or leaves, their pending invitations are revoked (section 9). If they are only demoted to MEMBER, existing pending invites they created remain valid until expiry or manual revoke. |

Why we do not re-check the inviter at accept: an invitee should not see a working link die because an admin was demoted. The workspace already authorized the invite. Removal/leave already revokes that person's pending invites, which covers the case where we no longer trust them.

No email is sent. The invite URL is a copyable result of the create-invitation API. That is an explicit limitation, not a hidden gap.

---

## 9. Membership removal

Leave (self) and remove (by OWNER/ADMIN) share this behavior.

| Topic | Decision |
|---|---|
| Access | Immediate. The membership row is deleted. Further workspace API calls return 404 (no membership). |
| Document ownership | `uploaded_by` stays. Files are not reassigned. |
| Existing documents | Remain in the workspace. Other members can still see them. OWNER/ADMIN can rename or delete them. |
| Share links created by that user | Revoked immediately (`revoked_at`). |
| Invitations created by that user | Pending invitations they created are revoked. |

Why revoke their links: a removed person should not keep a live public URL they issued. Why keep documents: the files belong to the workspace, not the person.

Removing a member does not revoke their login session. They may still belong to other workspaces.

---

## 10. Document deletion

Chosen lifecycle:

1. Authenticate.
2. Authorize (own document, or ADMIN/OWNER).
3. In one database transaction:
   - set `documents.deleted_at` (status stays `ready`; ready + deleted_at means "was uploaded, now deleted")
   - set `revoked_at` on all not-yet-revoked share links for that document
   - insert a `storage_cleanup_jobs` row for the object key
4. Commit. The document is unavailable to members and to share-link access immediately.
5. Best-effort delete the object from storage.
6. If storage delete succeeds, mark the cleanup job done.
7. If storage delete fails, the in-process retry loop keeps the job.

A second delete of the same document is treated as not found.

The document is unavailable as soon as the transaction commits, even if the object still exists. Availability is an application decision, not an S3 decision.

We do not try to make PostgreSQL and object storage one transaction.

Workspace deletion uses the same idea at a larger scope: set `workspaces.deleted_at`, revoke pending invitations, enqueue cleanup jobs for that workspace's object keys, commit, then delete objects.

---

## 11. Audit

Implemented. This is the single product improvement (see section 12).

Audit is **workspace-scoped**. We do not store login success/failure in this table (those events have no workspace, and failure logs become an enumeration aid if exposed).

Recorded events:

- `workspace.created` / `workspace.deleted` / `workspace.ownership_transferred`
- `member.invited` / `member.invite_revoked` / `member.invite_accepted`
- `member.removed` / `member.left` / `member.role_changed`
- `document.uploaded` / `document.renamed` / `document.deleted` / `document.downloaded`
- `share_link.created` / `share_link.revoked` / `share_link.downloaded`

Each row stores: actor user id (nullable for public share downloads), workspace id, action, resource type, resource id, timestamp, request id, and a small JSON metadata object (filename, role, etc.).

Never stored: passwords, session tokens, share tokens, invite tokens, authorization headers, signed URLs, file bytes.

Audit rows are append-only. OWNER and ADMIN can list audit events for their workspace. MEMBER cannot. No filters, export, or retention UI in this assignment.

---

## 12. Product improvement

Chosen: **audit trail**.

| Candidate | Why not |
|---|---|
| Versioning | Extra storage objects, restore rules, and UI. Easy to get deletion wrong. |
| Password-protected links | Useful, but adds hashing, UX, and another rate-limit surface on an already sensitive link. |
| Quotas | Aggregation and enforcement on every upload. Not the assignment's main score area. |
| Folders | Tree queries and move/rename edge cases. Mostly frontend. |
| Virus scanning | Usually a queue plus another runtime. Out of proportion. |
| Search | Indexing and ranking. Not needed to show authorization or storage design. |
| Notifications | Fake without email or realtime. |

Audit trail is the one extra because the assignment scores security and authorization, it fits in PostgreSQL, and it does not add Redis, a queue, or Python.

---

## 13. Edge cases

| Scenario | Expected behavior |
|---|---|
| Cross-workspace document access | 404. Lookup is membership + workspace + document. |
| Removed member accessing old URL | 404. No membership. |
| Expired share link | Same public not-found as a bad token. No file. |
| Revoked share link | Same as expired. |
| Deleted document with active link | Link fails. Object may still exist until cleanup runs. |
| Deleted workspace with pending invitation | Accept fails. Invite is unusable. |
| Expired invitation | Accept fails. |
| Invitation accepted twice | Second accept fails. One membership row. |
| Wrong account accepting invitation | Accept fails. Email must match. |
| Concurrent invitation acceptance | One transaction wins. Unique membership prevents doubles. |
| Duplicate invitation | New pending invite replaces the previous pending invite for that workspace+email. |
| Storage succeeds but DB fails | Handler deletes the object if it can. Otherwise enqueue cleanup if the DB is still reachable. Client sees an error. No ready document. |
| DB succeeds but storage fails | Pending row is not promoted to ready. Cleanup removes the row and any partial object. Client sees an error. |
| Deletion failure (S3 delete fails) | Document is already soft-deleted and links are revoked. Cleanup job retries object delete. |
| Duplicate filename | Allowed. Two documents, two IDs. |
| Oversized upload | Rejected with a validation error. Object is not kept. |
| Forged document ID | 404 if it is not in a workspace the caller belongs to. |
| Forged workspace ID | 404 if the caller is not a member. |
| Member deletes another user's document | 403. They are a member without permission. |
| Download in progress when document is deleted | In-flight stream may finish. Later requests fail. |
| Admin demoted after sending an invite | Pending invite stays valid until expiry, replace, or revoke. |
| Admin removed after sending an invite | Their pending invites are revoked. Accept fails. |
| Transfer ownership to a MEMBER | That member becomes OWNER. Previous owner becomes ADMIN. |

---

## 14. Out of scope

Intentionally not building:

- Password reset, email verification, magic links, SSO, OAuth, 2FA
- Outbound email (invites are copyable URLs)
- CSRF tokens (same-site cookie + SameSite=Lax instead)
- Sliding sessions / refresh tokens
- Document restore / recycle bin
- Per-document ACLs
- File versioning
- Folders / tags
- Full-text search
- Notifications
- Password-protected share links
- Presigned download URLs
- Download caps on share links
- Quotas and billing
- Virus scanning (we do extension + MIME + magic-byte/NUL checks, not AV)
- Bucket-wide orphan sweeps
- Document preview / thumbnails
- Audit filters, export, or retention jobs
- Redis, BullMQ, Python services, Kafka, Kubernetes, Terraform
- Stored procedures, triggers, or views unless a later phase has a concrete reason

These can be named as follow-ups in the README. They are not part of the weekend deliverable.
