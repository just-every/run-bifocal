-- Draft definitions and source references only: no retained prepared rows.
CREATE TABLE bf_preparations (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, version INTEGER NOT NULL
);
CREATE TABLE bf_preparation_revisions (
 preparation_id TEXT NOT NULL REFERENCES bf_preparations(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, document_json TEXT NOT NULL, sources_json TEXT NOT NULL,
 digest TEXT NOT NULL, lineage_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(preparation_id,version)
);
CREATE TABLE bf_preparation_sources (
 preparation_id TEXT NOT NULL REFERENCES bf_preparations(id) ON DELETE CASCADE,
 dataset_id TEXT NOT NULL, PRIMARY KEY(preparation_id,dataset_id)
);
CREATE TRIGGER bf_preparation_source_erased BEFORE DELETE ON bf_file_tables BEGIN
 DELETE FROM bf_preparations WHERE id IN (
  SELECT preparation_id FROM bf_preparation_sources WHERE dataset_id=OLD.id
 );
END;
