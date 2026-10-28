CREATE TABLE bf_collaboration_participants (
 subject_key TEXT NOT NULL REFERENCES bf_collaboration_subjects(key) ON DELETE CASCADE,
 operator_id TEXT NOT NULL, grant_id TEXT NOT NULL REFERENCES bf_explore_grants(id) ON DELETE CASCADE,
 owner_version INTEGER NOT NULL, operator_version INTEGER NOT NULL,
 PRIMARY KEY(subject_key,operator_id)
);
CREATE TRIGGER bf_collaboration_participant_membership AFTER UPDATE ON oa_operators
WHEN NEW.version<>OLD.version OR NEW.status<>OLD.status OR NEW.role<>OLD.role BEGIN
 DELETE FROM bf_collaboration_participants WHERE operator_id=NEW.id
 OR subject_key IN (SELECT key FROM bf_collaboration_subjects WHERE owner_id=NEW.id);
END;
CREATE TRIGGER bf_collaboration_participant_grant_retired AFTER DELETE ON bf_explore_activation BEGIN
 UPDATE bf_collaboration_links SET revoked=1 WHERE subject_key IN
 (SELECT subject_key FROM bf_collaboration_participants WHERE grant_id=OLD.grant_id);
 DELETE FROM bf_collaboration_participants WHERE grant_id=OLD.grant_id;
END;
