-- Portable role-policy intent remains inactive. No exploration grant or
-- activation table references this definition lifecycle.
CREATE TABLE bf_policy_definition_revisions (
 owner_id TEXT NOT NULL, policy_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 document_json TEXT NOT NULL CHECK(json_valid(document_json)), digest TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,policy_id,revision)
);
CREATE TABLE bf_policy_definitions (
 owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(owner_id,id),
 FOREIGN KEY(owner_id,id,revision) REFERENCES bf_policy_definition_revisions(owner_id,policy_id,revision)
);
CREATE TABLE bf_policy_definition_audit (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 policy_id TEXT NOT NULL, revision INTEGER, digest TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('read','review','apply')), recorded_at TEXT NOT NULL
);
CREATE TRIGGER bf_policy_revision_immutable BEFORE UPDATE ON bf_policy_definition_revisions BEGIN SELECT RAISE(ABORT,'immutable_policy_revision'); END;
CREATE TRIGGER bf_policy_audit_immutable BEFORE UPDATE ON bf_policy_definition_audit BEGIN SELECT RAISE(ABORT,'immutable_policy_audit'); END;
