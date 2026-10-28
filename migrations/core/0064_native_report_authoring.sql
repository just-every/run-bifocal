CREATE TABLE bf_native_reports (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES oa_operators(id),
 version INTEGER NOT NULL CHECK(version > 0),
 created_at TEXT NOT NULL
);
CREATE TABLE bf_native_report_revisions (
 report_id TEXT NOT NULL REFERENCES bf_native_reports(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 definition_json TEXT NOT NULL,
 definition_digest TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(report_id,revision)
);
CREATE TABLE bf_native_report_runs (
 id TEXT PRIMARY KEY,
 report_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 owner_version INTEGER NOT NULL,
 manifest_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(report_id,revision) REFERENCES bf_native_report_revisions(report_id,revision) ON DELETE CASCADE
);
CREATE TABLE bf_native_report_artifacts (
 run_id TEXT NOT NULL REFERENCES bf_native_report_runs(id) ON DELETE CASCADE,
 format TEXT NOT NULL CHECK(format IN ('pdf','xlsx','csv')),
 content BLOB NOT NULL,
 digest TEXT NOT NULL,
 PRIMARY KEY(run_id,format)
);
CREATE TABLE bf_native_report_audit (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES bf_native_report_runs(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL REFERENCES oa_operators(id),
 action TEXT NOT NULL,
 recorded_at TEXT NOT NULL
);
CREATE INDEX bf_native_report_snapshot ON bf_native_report_revisions(snapshot_id);
