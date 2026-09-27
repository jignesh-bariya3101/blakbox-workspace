-- Document list and audit list both paginate with
-- ORDER BY created_at DESC, id DESC. Include id so the planner can
-- satisfy the sort and keyset predicate from the index.

DROP INDEX IF EXISTS "documents_workspace_ready_alive";
CREATE INDEX "documents_workspace_ready_alive"
ON "documents" ("workspace_id", "created_at" DESC, "id" DESC)
WHERE "deleted_at" IS NULL AND "status" = 'ready';

DROP INDEX IF EXISTS "audit_events_workspace_id_created_at_idx";
CREATE INDEX "audit_events_workspace_id_created_at_id_idx"
ON "audit_events" ("workspace_id", "created_at" DESC, "id" DESC);
