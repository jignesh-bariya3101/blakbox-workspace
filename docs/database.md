# Database

PostgreSQL via Prisma. Schema: `server/prisma/schema.prisma`.

No stored procedures, triggers, views, or functions. The only PostgreSQL-specific features are **partial unique indexes**, **partial lookup indexes**, and **CHECK** constraints. Those belong in the database because the application cannot enforce them under concurrency.

## Deletion

| Entity | Behavior | Why |
|---|---|---|
| User | Not deleted in this product. FKs are `ON DELETE RESTRICT`. | Avoids orphaned `uploaded_by` / inviter history. |
| Workspace | Soft delete (`deleted_at`). Hard delete is blocked while children exist. | Accidental `DELETE FROM workspaces` must not cascade-wipe files and audit. |
| Membership | Hard delete. | Access is "row exists." History is in `audit_events`. |
| Document | Soft delete (`deleted_at`). Status stays `ready`. | Lists filter `deleted_at IS NULL AND status = 'ready'`. |
| Share link | `revoked_at` set; row kept. | Token hash stays unique; reuse of the same hash is impossible. |
| Invitation | Status becomes `revoked` / `accepted` / `replaced`. Row kept. | Token hash uniqueness. |

`sessions` also use `RESTRICT` on user delete. Sessions are revoked by setting `revoked_at`, not by deleting the user.

## Extra entities (beyond the prompt list)

- `sessions` — hashed session tokens. Required by the auth decision.
- `storage_cleanup_jobs` — object-storage deletes cannot share a transaction with PostgreSQL.

## Indexes

Only indexes that match a real query. Unique constraints are listed first because they also serve lookups.

| Index | Query pattern | Reason | Benefit |
|---|---|---|---|
| `users_email_key` (unique) | `WHERE email = $login` | Login / register | Point lookup; rejects duplicate accounts. |
| `sessions_token_hash_key` (unique) | `WHERE token_hash = $hash` | Every authenticated request | Point lookup; token cannot collide. |
| `sessions_user_id_idx` | `WHERE user_id = $id` | FK support and "revoke all sessions for this user" if we ever add it. Logout itself uses `token_hash`. | Cheap; a user has few session rows. |
| `workspace_members_workspace_id_user_id_key` (unique) | `WHERE workspace_id = $w AND user_id = $u` | Membership + authorization | Point lookup; prevents double join. |
| `workspace_members_user_id_idx` | `WHERE user_id = $u` | List workspaces for the current user | Avoids scanning all memberships. |
| `workspace_members_one_owner` (unique, `role = OWNER`) | insert/update owner | Exactly one OWNER | Concurrent transfer cannot create two owners. |
| `workspace_invitations_token_hash_key` (unique) | `WHERE token_hash = $hash` | Accept invitation | Point lookup; token is a secret. |
| `workspace_invitations_workspace_id_email_idx` | `WHERE workspace_id = $w AND email = $e` | Create/replace invite | Find the current pending/history rows. |
| `workspace_invitations_one_pending` (unique, `status = pending`) | insert pending invite | One live invite per email | Concurrent create cannot issue two live tokens. |
| `documents_storage_key_key` (unique) | `WHERE storage_key = $key` | Upload identity, cleanup | Object key maps to one row. |
| `documents_workspace_id_created_at_idx` | fallback list / admin | Non-partial sibling of the ready list | Used when querying pending or deleted in a workspace (cleanup, workspace delete). |
| `documents_workspace_ready_alive` (partial ready + not deleted) | workspace document list `ORDER BY created_at DESC, id DESC` | Main list + keyset page | Matches filter and sort; `id` is the tie-breaker the query already uses. |
| `documents_pending_created_at` (partial pending) | `WHERE status = pending AND created_at < now() - 15m` | Stale upload cleanup | Loop does not scan ready documents. |
| `share_links_token_hash_key` (unique) | `WHERE token_hash = $hash` | Public share access | Point lookup; guessing hits a unique index. |
| `share_links_document_id_idx` | links for a document | Member UI / revoke-all | Direct children of a document. |
| `share_links_document_active` (partial `revoked_at IS NULL`) | revoke on document delete / member removal | Update live links only | Avoids rewriting already-revoked rows in the planner's favorite path. |
| `audit_events_workspace_id_created_at_id_idx` | `WHERE workspace_id = $w ORDER BY created_at DESC, id DESC` | OWNER/ADMIN audit list | Matches pagination and keyset. |
| `storage_cleanup_jobs_created_at_idx` | operational listing | Rare | Cheap; table stays small. |
| `storage_cleanup_jobs_incomplete` (partial `completed_at IS NULL`) | cleanup loop | Claim due jobs | Loop ignores finished jobs. |

`sessions_user_id_idx`: keep it. PostgreSQL uses it for the FK from sessions → users, and a user will not have many rows.

## Check constraints

| Constraint | Rule |
|---|---|
| `documents_byte_size_positive` | `byte_size > 0` |
| `share_links_download_count_nonnegative` | `download_count >= 0` |
| `storage_cleanup_jobs_attempts_nonnegative` | `attempts >= 0` |

Role and status closed sets are PostgreSQL enums generated from Prisma.

## Cross-workspace access

There is no database view that joins "documents the user can see." Authorization is application code: membership row + `workspace_id` on the resource. The schema makes a missing `workspace_id` filter harder (every document, invite, and audit row has a required `workspace_id`), but it cannot stop a buggy query. Tests for IDOR live in later API prompts.
