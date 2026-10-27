CREATE TABLE bf_rdl_imports (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 value_json TEXT NOT NULL,
 revision TEXT NOT NULL
);
