-- Preserve every existing input value and audit entry under its original schema.
ALTER TABLE bf_input_tables ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bf_input_tables ADD COLUMN schema_revision TEXT NOT NULL DEFAULT 'legacy-forecast-v1';
ALTER TABLE bf_input_tables ADD COLUMN schema_json TEXT NOT NULL DEFAULT '{"columns":[{"currency":"USD","label":"Adjustment (USD)","name":"adjustment","scale":2,"type":"money"},{"label":"Reason","maxLength":1000,"name":"note","type":"text"},{"label":"Effective date","name":"effectiveOn","type":"date"},{"label":"Apply adjustment","name":"active","type":"boolean"}],"effect":{"activeColumn":"active","column":"adjustment","kind":"adjustment"},"format":1,"template":"forecast-adjustment"}';
ALTER TABLE bf_input_history ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE bf_input_schemas (
 table_id TEXT NOT NULL REFERENCES bf_input_tables(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version > 0), revision TEXT NOT NULL,
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
 actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, recorded_at TEXT NOT NULL,
 PRIMARY KEY(table_id,version)
);
CREATE TRIGGER bf_input_schemas_immutable BEFORE UPDATE ON bf_input_schemas
 BEGIN SELECT RAISE(ABORT,'immutable_input_schema'); END;

INSERT INTO bf_input_schemas(table_id,version,revision,definition_json,actor_id,actor_name,recorded_at)
 SELECT id,schema_version,schema_revision,schema_json,owner_id,'Legacy owner',created_at
 FROM bf_input_tables;

-- Explicitly erase schemas even when foreign-key enforcement is unavailable.
CREATE TRIGGER bf_input_schemas_removed BEFORE DELETE ON bf_input_tables BEGIN
 DELETE FROM bf_input_schemas WHERE table_id=old.id;
END;
