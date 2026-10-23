CREATE TABLE bf_quality_rules (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,dataset_id TEXT NOT NULL,rule_json TEXT NOT NULL);
CREATE INDEX bf_quality_dataset ON bf_quality_rules(dataset_id);
CREATE TABLE bf_quality_runs (
 id TEXT PRIMARY KEY,rule_id TEXT NOT NULL REFERENCES bf_quality_rules(id) ON DELETE CASCADE,
 source_revision TEXT,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE bf_quality_waivers (
 run_id TEXT PRIMARY KEY REFERENCES bf_quality_runs(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,reason TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
);
