CREATE TABLE bf_report_series (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, period TEXT NOT NULL, next_revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE bf_report_retention (owner_id TEXT PRIMARY KEY, version INTEGER NOT NULL, days INTEGER, consented_at TEXT NOT NULL);
CREATE TABLE bf_report_runs (
 id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES bf_report_series(id), owner_id TEXT NOT NULL,
 revision INTEGER NOT NULL, corrects TEXT REFERENCES bf_report_runs(id), period TEXT NOT NULL,
 snapshot_id TEXT REFERENCES bf_query_snapshots(id) ON DELETE SET NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','rendered','approved','dispatching','accepted','uncertain','rejected','development','cancelled','erased')),
 request_json TEXT CHECK(request_json IS NULL OR json_valid(request_json)), artifact_json TEXT CHECK(artifact_json IS NULL OR json_valid(artifact_json)),
 artifact_digest TEXT, approval_json TEXT CHECK(approval_json IS NULL OR json_valid(approval_json)),
 retain_until TEXT, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(series_id,revision)
);
CREATE TABLE bf_report_dispatches (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES bf_report_runs(id), artifact_digest TEXT NOT NULL,
 owner_id TEXT NOT NULL, recipient_id TEXT NOT NULL, recipient_version INTEGER NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('accepted','uncertain','rejected','development')),
 provider TEXT NOT NULL, provider_reference TEXT, recorded_at TEXT NOT NULL
);
CREATE TABLE bf_report_downloads (
 token_hash TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES bf_report_runs(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bf_report_audit (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES bf_report_runs(id), actor_id TEXT NOT NULL,
 action TEXT NOT NULL, version INTEGER NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TRIGGER bf_report_artifact_immutable BEFORE UPDATE ON bf_report_runs WHEN old.artifact_json IS NOT NULL AND new.artifact_json IS NOT NULL AND (old.artifact_json<>new.artifact_json OR old.artifact_digest<>new.artifact_digest) BEGIN SELECT RAISE(ABORT,'immutable_report_artifact'); END;
CREATE TRIGGER bf_report_identity_immutable BEFORE UPDATE ON bf_report_runs WHEN old.id<>new.id OR old.series_id<>new.series_id OR old.owner_id<>new.owner_id OR old.revision<>new.revision OR old.period<>new.period OR old.corrects IS NOT new.corrects BEGIN SELECT RAISE(ABORT,'immutable_report_revision'); END;
CREATE TRIGGER bf_report_dispatch_immutable BEFORE UPDATE ON bf_report_dispatches BEGIN SELECT RAISE(ABORT,'immutable_dispatch_fact'); END;
CREATE TRIGGER bf_report_dispatch_no_delete BEFORE DELETE ON bf_report_dispatches BEGIN SELECT RAISE(ABORT,'immutable_dispatch_fact'); END;
CREATE TRIGGER bf_report_audit_immutable BEFORE UPDATE ON bf_report_audit BEGIN SELECT RAISE(ABORT,'immutable_report_audit'); END;
-- Source erasure withdraws controlled bytes and pending work, preserving only
-- pseudonymous dispatch facts, revision relations and minimal audit.
CREATE TRIGGER bf_report_snapshot_erased BEFORE DELETE ON bf_query_snapshots BEGIN
 DELETE FROM bf_report_downloads WHERE run_id IN (SELECT id FROM bf_report_runs WHERE snapshot_id=old.id);
 UPDATE bf_report_runs SET state=CASE WHEN state IN ('queued','rendered','approved') THEN 'cancelled' ELSE 'erased' END,request_json=NULL,artifact_json=NULL,artifact_digest=NULL,approval_json=NULL,version=version+1 WHERE snapshot_id=old.id;
END;

CREATE TABLE bf_report_dispatch_claims (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES bf_report_runs(id),
 artifact_digest TEXT NOT NULL, owner_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
 recipient_version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER bf_report_claim_immutable BEFORE UPDATE ON bf_report_dispatch_claims BEGIN SELECT RAISE(ABORT,'immutable_dispatch_claim'); END;
CREATE TRIGGER bf_report_claim_no_delete BEFORE DELETE ON bf_report_dispatch_claims BEGIN SELECT RAISE(ABORT,'immutable_dispatch_claim'); END;
CREATE TABLE bf_report_retention_audit (
 owner_id TEXT NOT NULL, actor_id TEXT NOT NULL, version INTEGER NOT NULL, days INTEGER,
 consented_at TEXT NOT NULL, PRIMARY KEY(owner_id,version)
);
CREATE TRIGGER bf_report_retention_audit_immutable BEFORE UPDATE ON bf_report_retention_audit BEGIN SELECT RAISE(ABORT,'immutable_retention_consent'); END;
