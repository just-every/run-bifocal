-- Existing activations have no proof that their revisions never changed and
-- returned. Retire them once; a fresh exact owner review issues a new grant.
INSERT INTO bf_explore_audit(id,owner_id,actor_id,grant_id,digest,action,recorded_at)
 SELECT lower(hex(randomblob(16))),g.owner_id,'system',g.id,g.digest,'migration-reapproval-required',strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM bf_explore_grants g JOIN bf_explore_activation a ON a.grant_id=g.id;
DELETE FROM bf_explore_activation;

-- Revocation is lasting: restoring a pointer or an imported before-image does
-- not recreate activation. These fences apply to every native mutation door.
CREATE TRIGGER bf_explore_model_revision AFTER UPDATE OF production ON bf_semantic_models
WHEN new.production IS NOT old.production BEGIN
 INSERT INTO bf_explore_audit(id,owner_id,actor_id,grant_id,digest,action,recorded_at)
  SELECT lower(hex(randomblob(16))),g.owner_id,'system',g.id,g.digest,'model-invalidated',strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM bf_explore_grants g JOIN bf_explore_activation a ON a.grant_id=g.id WHERE g.model_id=new.id;
 DELETE FROM bf_explore_activation WHERE grant_id IN
  (SELECT id FROM bf_explore_grants WHERE model_id=new.id);
END;
CREATE TRIGGER bf_explore_source_revision AFTER UPDATE ON bf_file_tables
WHEN new.revision IS NOT old.revision OR new.value_json IS NOT old.value_json BEGIN
 INSERT INTO bf_explore_audit(id,owner_id,actor_id,grant_id,digest,action,recorded_at)
  SELECT lower(hex(randomblob(16))),g.owner_id,'system',g.id,g.digest,'source-invalidated',strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM bf_explore_grants g JOIN bf_explore_activation a ON a.grant_id=g.id
  WHERE EXISTS(SELECT 1 FROM json_each(g.definition_json,'$.sources') s WHERE json_extract(s.value,'$.id')=old.id);
 DELETE FROM bf_explore_activation WHERE grant_id IN
  (SELECT g.id FROM bf_explore_grants g, json_each(g.definition_json,'$.sources') s
   WHERE json_extract(s.value,'$.id')=old.id);
END;
CREATE TRIGGER bf_explore_source_removed BEFORE DELETE ON bf_file_tables BEGIN
 INSERT INTO bf_explore_audit(id,owner_id,actor_id,grant_id,digest,action,recorded_at)
  SELECT lower(hex(randomblob(16))),g.owner_id,'system',g.id,g.digest,'source-invalidated',strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM bf_explore_grants g JOIN bf_explore_activation a ON a.grant_id=g.id
  WHERE EXISTS(SELECT 1 FROM json_each(g.definition_json,'$.sources') s WHERE json_extract(s.value,'$.id')=old.id);
 DELETE FROM bf_explore_activation WHERE grant_id IN
  (SELECT g.id FROM bf_explore_grants g, json_each(g.definition_json,'$.sources') s
   WHERE json_extract(s.value,'$.id')=old.id);
END;
