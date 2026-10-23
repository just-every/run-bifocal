CREATE TABLE bf_metrics (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, head_revision INTEGER NOT NULL,
 published_revision INTEGER
);
CREATE TABLE bf_metric_revisions (
 metric_id TEXT NOT NULL REFERENCES bf_metrics(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, dataset_id TEXT NOT NULL, document_json TEXT NOT NULL,
 digest TEXT NOT NULL, created_at TEXT NOT NULL, approved_at TEXT, annotation TEXT,
 PRIMARY KEY(metric_id,revision)
);
CREATE INDEX bf_metric_dataset ON bf_metric_revisions(dataset_id);
CREATE TABLE bf_metric_uses (
 snapshot_id TEXT PRIMARY KEY REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 metric_id TEXT NOT NULL, revision INTEGER NOT NULL,
 FOREIGN KEY(metric_id,revision) REFERENCES bf_metric_revisions(metric_id,revision) ON DELETE CASCADE
);
