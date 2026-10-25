-- Exact view authority is separate from foundation roles and file custody.
CREATE TABLE bf_explore_grants (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, operator_id TEXT NOT NULL,
 model_id TEXT NOT NULL REFERENCES bf_semantic_models(id) ON DELETE CASCADE,
 revision TEXT NOT NULL, view_id TEXT NOT NULL, definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
 digest TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX bf_explore_grants_operator ON bf_explore_grants(operator_id);
-- Activation is installation-local and excluded from portable archives.
CREATE TABLE bf_explore_activation (
 grant_id TEXT PRIMARY KEY REFERENCES bf_explore_grants(id) ON DELETE CASCADE,
 owner_version INTEGER NOT NULL, operator_version INTEGER NOT NULL
);
CREATE TABLE bf_explore_audit (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 grant_id TEXT NOT NULL, digest TEXT NOT NULL, action TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TRIGGER bf_explore_membership AFTER UPDATE ON oa_operators WHEN new.version<>old.version OR new.status<>old.status OR new.role<>old.role BEGIN
 DELETE FROM bf_explore_activation WHERE grant_id IN (SELECT id FROM bf_explore_grants WHERE operator_id=new.id OR owner_id=new.id);
END;
CREATE TRIGGER bf_explore_definition_immutable BEFORE UPDATE ON bf_explore_grants BEGIN SELECT RAISE(ABORT,'immutable_exploration_grant'); END;
CREATE TRIGGER bf_explore_audit_immutable BEFORE UPDATE ON bf_explore_audit BEGIN SELECT RAISE(ABORT,'immutable_exploration_audit'); END;
