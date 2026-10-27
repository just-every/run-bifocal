CREATE TABLE bf_security_policy (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 revision INTEGER NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 prefixes_json TEXT NOT NULL
);
CREATE TABLE bf_security_audit (
 sequence INTEGER PRIMARY KEY,
 event_json TEXT NOT NULL,
 previous_hash TEXT NOT NULL,
 hash TEXT NOT NULL UNIQUE
);
CREATE TABLE bf_security_audit_head (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 sequence INTEGER NOT NULL,
 hash TEXT NOT NULL,
 signature TEXT NOT NULL
);
CREATE TRIGGER bf_security_audit_no_update BEFORE UPDATE ON bf_security_audit
 BEGIN SELECT RAISE(ABORT,'security_audit_append_only'); END;
CREATE TRIGGER bf_security_audit_no_delete BEFORE DELETE ON bf_security_audit
 BEGIN SELECT RAISE(ABORT,'security_audit_append_only'); END;
CREATE TRIGGER bf_security_audit_no_replace BEFORE INSERT ON bf_security_audit
 WHEN EXISTS(SELECT 1 FROM bf_security_audit WHERE sequence=NEW.sequence)
 OR NEW.sequence != COALESCE((SELECT sequence FROM bf_security_audit_head WHERE singleton=1),0)+1
 OR NEW.previous_hash != COALESCE((SELECT hash FROM bf_security_audit_head WHERE singleton=1),'genesis')
 BEGIN SELECT RAISE(ABORT,'security_audit_chain_conflict'); END;
CREATE TRIGGER bf_security_audit_head_no_delete BEFORE DELETE ON bf_security_audit_head
 BEGIN SELECT RAISE(ABORT,'security_audit_append_only'); END;
CREATE TRIGGER bf_security_audit_head_monotonic BEFORE UPDATE ON bf_security_audit_head
 WHEN NEW.sequence != OLD.sequence+1
 BEGIN SELECT RAISE(ABORT,'security_audit_chain_conflict'); END;
