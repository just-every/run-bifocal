CREATE TABLE bf_retained_quality (
 snapshot_id TEXT PRIMARY KEY REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 checked_at TEXT NOT NULL,
 evidence_json TEXT NOT NULL
);
