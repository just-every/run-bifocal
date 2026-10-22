-- Owner-bound immutable exact answers; source deletion withdraws derived data.
CREATE TABLE bf_query_snapshots (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL,
 query_json TEXT NOT NULL CHECK(json_valid(query_json)),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 answer_json TEXT NOT NULL CHECK(json_valid(answer_json)),
 digest TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bf_query_sources (
 snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 dataset_id TEXT NOT NULL, revision TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 PRIMARY KEY(snapshot_id,dataset_id)
);
CREATE INDEX bf_query_sources_dataset ON bf_query_sources(dataset_id);
CREATE TABLE bf_query_artifacts (
 id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('dashboard','report')),
 snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 title TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER bf_query_snapshot_immutable BEFORE UPDATE ON bf_query_snapshots BEGIN SELECT RAISE(ABORT,'immutable_snapshot'); END;
CREATE TRIGGER bf_query_source_immutable BEFORE UPDATE ON bf_query_sources BEGIN SELECT RAISE(ABORT,'immutable_snapshot'); END;
CREATE TRIGGER bf_query_artifact_immutable BEFORE UPDATE ON bf_query_artifacts BEGIN SELECT RAISE(ABORT,'immutable_artifact'); END;
