-- Both subjects remain actual native immutable exact-query snapshots. Erasing
-- either source withdraws its snapshot and this controlled derived artifact.
CREATE TABLE bf_exploration_compositions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
 left_snapshot TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 right_snapshot TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)), digest TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER bf_exploration_composition_immutable BEFORE UPDATE ON bf_exploration_compositions BEGIN SELECT RAISE(ABORT,'immutable_exploration_composition'); END;
