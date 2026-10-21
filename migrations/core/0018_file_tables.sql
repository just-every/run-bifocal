-- Current datasets are complete immutable-value snapshots. Prior versions,
-- originals, reviewed mappings and approval history belong to shared import-kit.
CREATE TABLE bf_file_tables (
 id TEXT PRIMARY KEY NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json) AND length(CAST(value_json AS BLOB))<=786432),
 revision TEXT NOT NULL
);
