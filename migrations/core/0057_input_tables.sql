-- Bounded analytical inputs stay separate from the observed source table.
CREATE TABLE bf_input_tables (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
 dataset_id TEXT NOT NULL, source_revision TEXT NOT NULL, definition_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX bf_input_tables_source ON bf_input_tables(dataset_id);
CREATE TABLE bf_input_rows (
 table_id TEXT NOT NULL REFERENCES bf_input_tables(id) ON DELETE CASCADE,
 row_key TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), value_json TEXT NOT NULL,
 PRIMARY KEY(table_id,row_key)
);
CREATE TABLE bf_input_history (
 table_id TEXT NOT NULL REFERENCES bf_input_tables(id) ON DELETE CASCADE,
 row_key TEXT NOT NULL, version INTEGER NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
 before_json TEXT, after_json TEXT NOT NULL, recorded_at TEXT NOT NULL,
 PRIMARY KEY(table_id,row_key,version)
);
CREATE TRIGGER bf_input_history_immutable BEFORE UPDATE ON bf_input_history
 BEGIN SELECT RAISE(ABORT,'immutable_input_history'); END;
-- Explicit source erasure also removes the analytical inputs and their notes.
CREATE TRIGGER bf_input_source_removed BEFORE DELETE ON bf_file_tables BEGIN
 DELETE FROM bf_input_history WHERE table_id IN (SELECT id FROM bf_input_tables WHERE dataset_id=old.id);
 DELETE FROM bf_input_rows WHERE table_id IN (SELECT id FROM bf_input_tables WHERE dataset_id=old.id);
 DELETE FROM bf_input_tables WHERE dataset_id=old.id;
END;
