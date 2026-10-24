CREATE TABLE bf_model_imports (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 value_json TEXT NOT NULL,
 revision TEXT NOT NULL
);
CREATE TABLE bf_model_revision_imports (
 revision_id TEXT PRIMARY KEY REFERENCES bf_semantic_revisions(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 project_revision TEXT NOT NULL,
 format TEXT NOT NULL,
 digest TEXT NOT NULL
);
CREATE TABLE bf_model_import_uses (
 snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 PRIMARY KEY(snapshot_id,project_id)
);
CREATE TABLE bf_model_import_sources (
 project_id TEXT NOT NULL,
 dataset_id TEXT NOT NULL,
 PRIMARY KEY(project_id,dataset_id)
);
