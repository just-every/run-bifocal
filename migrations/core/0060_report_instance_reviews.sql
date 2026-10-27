CREATE TABLE bf_report_instance_reviews (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES bf_report_runs(id),
 actor_id TEXT NOT NULL,
 context_json TEXT,
 fingerprint TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 approved_at TEXT
);
CREATE TABLE bf_report_review_activation (
 review_id TEXT PRIMARY KEY REFERENCES bf_report_instance_reviews(id)
);
CREATE INDEX bf_report_instance_reviews_run ON bf_report_instance_reviews(run_id);
CREATE TRIGGER bf_report_reviews_withdrawn AFTER UPDATE ON bf_report_runs
 WHEN new.artifact_json IS NULL AND old.artifact_json IS NOT NULL BEGIN
 DELETE FROM bf_report_review_activation WHERE review_id IN (SELECT id FROM bf_report_instance_reviews WHERE run_id=new.id);
 UPDATE bf_report_instance_reviews SET context_json=NULL WHERE run_id=new.id;
END;
CREATE TRIGGER bf_report_review_membership AFTER UPDATE ON oa_operators
 WHEN new.version<>old.version OR new.status<>old.status OR new.role<>old.role BEGIN
 DELETE FROM bf_report_review_activation WHERE review_id IN (SELECT id FROM bf_report_instance_reviews WHERE actor_id=new.id);
END;
CREATE TABLE bf_report_grant_reviews (
 grant_id TEXT PRIMARY KEY REFERENCES bf_report_reviewer_grants(id) ON DELETE CASCADE,
 context_json TEXT NOT NULL CHECK(json_valid(context_json))
);
