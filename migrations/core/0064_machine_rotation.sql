ALTER TABLE bf_machine_credentials ADD COLUMN predecessor_id TEXT;
CREATE UNIQUE INDEX bf_machine_rotation_predecessor ON bf_machine_credentials(predecessor_id);
-- A retired activation is permanent, including a rotation predecessor.
CREATE TRIGGER bf_machine_no_reactivation BEFORE UPDATE OF revoked ON bf_machine_credentials
WHEN OLD.revoked=1 AND NEW.revoked=0 BEGIN
 SELECT RAISE(ABORT,'credential_permanently_retired');
END;
