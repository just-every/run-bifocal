-- Installation-local approvals and receipts contain no bearer or action payload.
-- They are deliberately outside the installation archive's selected tables.
CREATE TABLE bf_action_grants (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_version INTEGER NOT NULL,
 table_id TEXT NOT NULL, provider TEXT NOT NULL, origin TEXT NOT NULL,
 target TEXT NOT NULL, workflow_id TEXT, fields_json TEXT NOT NULL, token_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE bf_action_receipts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, grant_id TEXT NOT NULL,
 table_id TEXT NOT NULL, request_ref TEXT NOT NULL, digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('review','attempting','acknowledged','rejected','unresolved','erased')),
 outcome TEXT, source_link TEXT, created_at TEXT NOT NULL, approved_at TEXT, settled_at TEXT,
 UNIQUE(owner_id,request_ref)
);
-- Source removal withdraws authority and source links while preserving an inert
-- request-reference fence. It never sends a deletion to a provider.
CREATE TRIGGER bf_action_inputs_removed BEFORE DELETE ON bf_input_tables BEGIN
 UPDATE bf_action_receipts SET state='erased',outcome=NULL,source_link=NULL
  WHERE table_id=old.id;
 DELETE FROM bf_action_grants WHERE table_id=old.id;
END;
