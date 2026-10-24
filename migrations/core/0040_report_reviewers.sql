CREATE TABLE bf_report_reviewer_grants (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES bf_report_runs(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL, reviewer_id TEXT NOT NULL,
 artifact_digest TEXT NOT NULL, owner_version INTEGER NOT NULL, reviewer_version INTEGER NOT NULL,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX bf_report_reviewer_lookup ON bf_report_reviewer_grants(run_id,reviewer_id,artifact_digest);
-- Definitions retain lineage; activation never travels in an installation export.
CREATE TABLE bf_report_reviewer_activation (
 grant_id TEXT PRIMARY KEY REFERENCES bf_report_reviewer_grants(id) ON DELETE CASCADE,
 owner_version INTEGER NOT NULL, reviewer_version INTEGER NOT NULL, activated_at TEXT NOT NULL
);
CREATE TABLE bf_report_grant_audit (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, grant_id TEXT, owner_id TEXT NOT NULL,
 actor_id TEXT, reviewer_id TEXT NOT NULL, artifact_digest TEXT,
 action TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE bf_report_pending_recipients (
 run_id TEXT NOT NULL REFERENCES bf_report_runs(id) ON DELETE CASCADE,
 reviewer_id TEXT NOT NULL, reviewer_version INTEGER NOT NULL,
 PRIMARY KEY(run_id,reviewer_id)
);
CREATE TRIGGER bf_report_grant_identity_immutable BEFORE UPDATE ON bf_report_reviewer_grants
 WHEN old.id<>new.id OR old.run_id<>new.run_id OR old.owner_id<>new.owner_id OR old.reviewer_id<>new.reviewer_id OR old.artifact_digest<>new.artifact_digest OR old.owner_version<>new.owner_version OR old.reviewer_version<>new.reviewer_version OR old.expires_at<>new.expires_at OR old.created_at<>new.created_at OR old.revoked_at IS NOT NULL AND new.revoked_at IS NOT old.revoked_at
 BEGIN SELECT RAISE(ABORT,'immutable_report_reviewer_grant'); END;
CREATE TRIGGER bf_report_grant_audit_immutable BEFORE UPDATE ON bf_report_grant_audit BEGIN SELECT RAISE(ABORT,'immutable_report_grant_audit'); END;
CREATE TRIGGER bf_report_grant_audit_no_delete BEFORE DELETE ON bf_report_grant_audit BEGIN SELECT RAISE(ABORT,'immutable_report_grant_audit'); END;
-- Native membership changes fence existing sessions and artifact grants at once.
CREATE TRIGGER bf_report_reviewer_membership AFTER UPDATE ON oa_operators WHEN new.version<>old.version OR new.status<>old.status OR new.role<>old.role BEGIN
 INSERT INTO bf_report_grant_audit(id,run_id,grant_id,owner_id,actor_id,reviewer_id,artifact_digest,action,recorded_at)
 SELECT lower(hex(randomblob(16))),run_id,id,owner_id,NULL,reviewer_id,artifact_digest,'membership-revoked',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM bf_report_reviewer_grants WHERE revoked_at IS NULL AND (reviewer_id=new.id OR owner_id=new.id);
 UPDATE bf_report_reviewer_grants SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL AND (reviewer_id=new.id OR owner_id=new.id);
 DELETE FROM bf_report_reviewer_activation WHERE grant_id IN (SELECT id FROM bf_report_reviewer_grants WHERE reviewer_id=new.id OR owner_id=new.id);
 UPDATE bf_report_runs SET state='cancelled',request_json=NULL,artifact_json=NULL,artifact_digest=NULL,approval_json=NULL,version=version+1
 WHERE state IN ('queued','rendered','approved') AND (id IN (SELECT run_id FROM bf_report_pending_recipients WHERE reviewer_id=new.id AND (reviewer_version<>new.version OR new.status<>'active')) OR owner_id=new.id AND (new.status<>'active' OR new.role<>'owner'));
END;
-- Source erasure and explicit cancellation and purge remove controlled authority,
-- while immutable dispatch and minimal audit facts survive unchanged.
CREATE TRIGGER bf_report_reviewer_bytes_withdrawn AFTER UPDATE ON bf_report_runs
 WHEN new.artifact_json IS NULL AND (old.artifact_json IS NOT NULL OR new.request_json IS NULL AND old.request_json IS NOT NULL) BEGIN
 DELETE FROM bf_report_reviewer_grants WHERE run_id=new.id;
 DELETE FROM bf_report_pending_recipients WHERE run_id=new.id;
 DELETE FROM bf_report_downloads WHERE run_id=new.id;
END;
