-- Local completed erasure work has no retained actor or subject identity.
CREATE TABLE bf_erasure_audit (
 id TEXT PRIMARY KEY, actor_ref TEXT NOT NULL, subject_ref TEXT NOT NULL, recorded_at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('source_erasure','retention_changed'))
);
CREATE TABLE bf_erasure_stores (
 audit_id TEXT NOT NULL REFERENCES bf_erasure_audit(id), store TEXT NOT NULL, rows INTEGER NOT NULL CHECK(rows>=0),
 PRIMARY KEY(audit_id,store)
);
CREATE TRIGGER bf_erasure_audit_immutable BEFORE UPDATE ON bf_erasure_audit BEGIN SELECT RAISE(ABORT,'immutable_erasure_audit'); END;
CREATE TRIGGER bf_erasure_audit_permanent BEFORE DELETE ON bf_erasure_audit BEGIN SELECT RAISE(ABORT,'permanent_erasure_audit'); END;
CREATE TRIGGER bf_erasure_stores_immutable BEFORE UPDATE ON bf_erasure_stores BEGIN SELECT RAISE(ABORT,'immutable_erasure_store'); END;
CREATE TRIGGER bf_erasure_stores_permanent BEFORE DELETE ON bf_erasure_stores BEGIN SELECT RAISE(ABORT,'permanent_erasure_store'); END;
CREATE TABLE bf_cost_budgets (
 scope TEXT NOT NULL CHECK(scope IN ('source','job','agent','tenant')), id TEXT NOT NULL,
 revision TEXT NOT NULL, limit_micro INTEGER NOT NULL CHECK(limit_micro>=0), warn_micro INTEGER NOT NULL CHECK(warn_micro>=0 AND warn_micro<=limit_micro),
 PRIMARY KEY(scope,id)
);
CREATE TABLE bf_cost_reservations (
 id TEXT PRIMARY KEY, scope TEXT NOT NULL, budget_id TEXT NOT NULL,
 estimated_micro INTEGER NOT NULL CHECK(estimated_micro>=0), actual_micro INTEGER CHECK(actual_micro>=0),
 state TEXT NOT NULL CHECK(state IN ('reserved','settled','released')), created_at TEXT NOT NULL,
 FOREIGN KEY(scope,budget_id) REFERENCES bf_cost_budgets(scope,id)
);
CREATE TABLE bf_cost_audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL, created_at TEXT NOT NULL
);
-- Minimum retention and legal holds never schedule automatic destruction.
CREATE TABLE bf_source_retention (
 dataset_id TEXT PRIMARY KEY, revision TEXT NOT NULL, legal_hold INTEGER NOT NULL CHECK(legal_hold IN (0,1)), minimum_retain_until TEXT
);
CREATE TRIGGER bf_erasure_audit_no_replace BEFORE INSERT ON bf_erasure_audit WHEN EXISTS(SELECT 1 FROM bf_erasure_audit WHERE id=new.id) BEGIN SELECT RAISE(ABORT,'immutable_erasure_audit'); END;
CREATE TRIGGER bf_erasure_stores_no_replace BEFORE INSERT ON bf_erasure_stores WHEN EXISTS(SELECT 1 FROM bf_erasure_stores WHERE audit_id=new.audit_id AND store=new.store) BEGIN SELECT RAISE(ABORT,'immutable_erasure_store'); END;
-- This routing row exists only inside the guarded retirement batch. The kit's
-- final journal insertion copies its completed counts then removes the route.
CREATE TABLE bf_erasure_pending (
 destination TEXT PRIMARY KEY, audit_id TEXT NOT NULL REFERENCES bf_erasure_audit(id)
);
CREATE TRIGGER bf_erasure_completed_custody AFTER INSERT ON ik_d1_erasure_journal WHEN EXISTS(SELECT 1 FROM bf_erasure_pending WHERE destination=new.destination) BEGIN
 INSERT INTO bf_erasure_stores(audit_id,store,rows)
 SELECT p.audit_id,json_extract(j.value,'$.store'),json_extract(j.value,'$.rows')
 FROM bf_erasure_pending p,json_each(new.stores_json) j WHERE p.destination=new.destination;
 DELETE FROM bf_erasure_pending WHERE destination=new.destination;
END;
