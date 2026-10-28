-- Source removal includes first-import Undo. Enforce retention in the same
-- trigger before any controlled alert history can be deleted.
DROP TRIGGER bf_alert_source_erasure;
CREATE TRIGGER bf_alert_source_erasure BEFORE DELETE ON bf_file_tables BEGIN
 SELECT RAISE(ABORT,'source_retention_hold') WHERE EXISTS(
  SELECT 1 FROM bf_source_retention WHERE dataset_id=OLD.id
   AND (legal_hold=1 OR minimum_retain_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 );
 DELETE FROM bf_alert_rules WHERE id IN (SELECT rule_id FROM bf_alert_sources WHERE dataset_id=OLD.id);
END;
