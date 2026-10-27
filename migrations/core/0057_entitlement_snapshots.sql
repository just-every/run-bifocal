CREATE TABLE bf_entitlement_snapshots (
 owner_id TEXT NOT NULL, model_id TEXT NOT NULL, view_id TEXT NOT NULL,
 revision INTEGER NOT NULL, document_json TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(owner_id,model_id,view_id)
);
CREATE TABLE bf_entitlement_audit (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 model_id TEXT NOT NULL, view_id TEXT NOT NULL, revision INTEGER NOT NULL,
 digest TEXT NOT NULL, action TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE bf_entitlement_history (
 owner_id TEXT NOT NULL, model_id TEXT NOT NULL, view_id TEXT NOT NULL,
 revision INTEGER NOT NULL, document_json TEXT NOT NULL, digest TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(owner_id,model_id,view_id,revision)
);
