CREATE TABLE bf_machine_credentials (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_version INTEGER NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, definition_json TEXT NOT NULL, digest TEXT NOT NULL,
 expires_at TEXT NOT NULL, max_operations INTEGER NOT NULL, used_operations INTEGER NOT NULL DEFAULT 0,
 revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE bf_machine_audit (
 id TEXT PRIMARY KEY, credential_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 actor_kind TEXT NOT NULL, action TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE INDEX bf_machine_audit_owner ON bf_machine_audit(owner_id,recorded_at);
-- Authority withdrawal is permanent; a later rollback never revives an old key.
CREATE TRIGGER bf_machine_model_withdrawal AFTER UPDATE OF production ON bf_semantic_models
WHEN OLD.production IS NOT NEW.production BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE json_extract(definition_json,'$.modelId')=OLD.id;
END;
CREATE TRIGGER bf_machine_model_removal AFTER DELETE ON bf_semantic_models BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE json_extract(definition_json,'$.modelId')=OLD.id;
END;
CREATE TRIGGER bf_machine_source_withdrawal AFTER UPDATE ON bf_file_tables BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE EXISTS(
  SELECT 1 FROM json_each(definition_json,'$.sources') s WHERE json_extract(s.value,'$.id')=OLD.id
 );
END;
CREATE TRIGGER bf_machine_source_removal AFTER DELETE ON bf_file_tables BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE EXISTS(
  SELECT 1 FROM json_each(definition_json,'$.sources') s WHERE json_extract(s.value,'$.id')=OLD.id
 );
END;
CREATE TRIGGER bf_machine_principal_withdrawal AFTER UPDATE OF version,status,role ON oa_operators
WHEN OLD.version IS NOT NEW.version OR OLD.status IS NOT NEW.status OR OLD.role IS NOT NEW.role BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE owner_id=OLD.id;
END;
