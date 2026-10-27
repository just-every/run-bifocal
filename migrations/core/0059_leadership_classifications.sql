CREATE TABLE bf_approval_classifications (
 operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id),
 revision INTEGER NOT NULL CHECK(revision>0),
 kind TEXT NOT NULL CHECK(kind IN ('none','leadership','board')),
 operator_version INTEGER NOT NULL CHECK(operator_version>0),
 expires_at TEXT,
 CHECK((kind='none' AND expires_at IS NULL) OR (kind<>'none' AND expires_at IS NOT NULL))
);
CREATE TABLE bf_approval_classification_audit (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 actor_version INTEGER NOT NULL, before_json TEXT NOT NULL CHECK(json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)), recorded_at TEXT NOT NULL
);
CREATE TRIGGER bf_approval_classification_audit_immutable BEFORE UPDATE ON bf_approval_classification_audit
 BEGIN SELECT RAISE(ABORT,'immutable_classification_audit'); END;
CREATE TRIGGER bf_approval_classification_audit_no_delete BEFORE DELETE ON bf_approval_classification_audit
 BEGIN SELECT RAISE(ABORT,'immutable_classification_audit'); END;
