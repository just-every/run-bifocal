-- Charts retain one immutable native answer; source erasure withdraws both.
CREATE TABLE bf_charts (
 id TEXT PRIMARY KEY NOT NULL,
 snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 visual_json TEXT NOT NULL CHECK(json_valid(visual_json)),
 owner_id TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TRIGGER bf_chart_immutable BEFORE UPDATE ON bf_charts BEGIN SELECT RAISE(ABORT,'immutable_chart'); END;
