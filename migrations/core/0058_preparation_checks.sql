CREATE TABLE bf_preparation_checks (
 owner_id TEXT NOT NULL, preparation_id TEXT NOT NULL, dataset_id TEXT NOT NULL, error_json TEXT NOT NULL,
 PRIMARY KEY(owner_id,preparation_id)
);
CREATE TABLE bf_preparation_check_sources (
 owner_id TEXT NOT NULL, preparation_id TEXT NOT NULL, dataset_id TEXT NOT NULL,
 revision TEXT NOT NULL, PRIMARY KEY(owner_id,preparation_id,dataset_id),
 FOREIGN KEY(owner_id,preparation_id) REFERENCES bf_preparation_checks(owner_id,preparation_id) ON DELETE CASCADE
);
CREATE TRIGGER bf_preparation_check_erased BEFORE DELETE ON bf_file_tables BEGIN
 DELETE FROM bf_preparation_checks WHERE (owner_id,preparation_id) IN (
  SELECT owner_id,preparation_id FROM bf_preparation_check_sources WHERE dataset_id=OLD.id
 );
END;
