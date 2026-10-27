CREATE TABLE bf_machine_source_rules (
 dataset_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), digest TEXT NOT NULL
);
CREATE TRIGGER bf_machine_source_policy_insert AFTER INSERT ON bf_machine_source_rules BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE EXISTS(
  SELECT 1 FROM json_each(definition_json,'$.sources') s WHERE json_extract(s.value,'$.id')=NEW.dataset_id
 );
END;
CREATE TRIGGER bf_machine_source_policy_update AFTER UPDATE ON bf_machine_source_rules BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE EXISTS(
  SELECT 1 FROM json_each(definition_json,'$.sources') s WHERE json_extract(s.value,'$.id')=NEW.dataset_id
 );
END;
CREATE TRIGGER bf_machine_source_policy_delete AFTER DELETE ON bf_machine_source_rules BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE EXISTS(
  SELECT 1 FROM json_each(definition_json,'$.sources') s WHERE json_extract(s.value,'$.id')=OLD.dataset_id
 );
END;
CREATE TRIGGER bf_machine_principal_removal BEFORE DELETE ON oa_operators BEGIN
 UPDATE bf_machine_credentials SET revoked=1 WHERE owner_id=OLD.id;
END;
CREATE TRIGGER bf_machine_retirement_audit AFTER UPDATE OF revoked ON bf_machine_credentials
WHEN OLD.revoked=0 AND NEW.revoked=1 BEGIN
 INSERT INTO bf_machine_audit(id,credential_id,owner_id,actor_kind,action,recorded_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.owner_id,'machine','activation-retired',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER bf_machine_source_policy_erasure AFTER DELETE ON bf_file_tables BEGIN
 DELETE FROM bf_machine_source_rules WHERE dataset_id=OLD.id;
END;
