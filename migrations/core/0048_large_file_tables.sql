-- Preserve complete native values while increasing their explicit byte bound.
-- No table references this table through a foreign key. Rebuilding it must not
-- retire grants: source identity, revision and content remain exactly unchanged.
DROP TRIGGER bf_explore_source_revision;
DROP TRIGGER bf_explore_source_removed;

CREATE TABLE bf_file_tables_large (
 id TEXT PRIMARY KEY NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json) AND length(CAST(value_json AS BLOB))<=1900000),
 revision TEXT NOT NULL
);
INSERT INTO bf_file_tables_large(id,value_json,revision)
 SELECT id,value_json,revision FROM bf_file_tables;
DROP TABLE bf_file_tables;
ALTER TABLE bf_file_tables_large RENAME TO bf_file_tables;

-- Preserve the lasting source-revision fences from migration 0042.
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
