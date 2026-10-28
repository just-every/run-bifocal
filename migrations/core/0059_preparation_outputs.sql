-- Bounded native materializations; the columnar analytical job store is separate.
CREATE TABLE bf_preparation_outputs (
 dataset_id TEXT PRIMARY KEY REFERENCES bf_file_tables(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL, preparation_id TEXT NOT NULL, version INTEGER NOT NULL,
 digest TEXT NOT NULL, lineage_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bf_preparation_output_sources (
 output_id TEXT NOT NULL REFERENCES bf_preparation_outputs(dataset_id) ON DELETE CASCADE,
 dataset_id TEXT NOT NULL, revision TEXT NOT NULL,
 PRIMARY KEY(output_id,dataset_id)
);
CREATE INDEX bf_preparation_output_parent ON bf_preparation_output_sources(dataset_id);
-- Durable withdrawal fence survives interruption before descendant cleanup.
CREATE TABLE bf_preparation_erasing (dataset_id TEXT PRIMARY KEY);
CREATE TABLE bf_preparation_erasing_projects (project_id TEXT PRIMARY KEY);
