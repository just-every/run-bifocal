CREATE TABLE bf_preparation_imports (
 preparation_id TEXT NOT NULL REFERENCES bf_preparations(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 PRIMARY KEY(preparation_id,project_id)
);
CREATE TRIGGER bf_preparation_import_erased BEFORE DELETE ON bf_model_imports BEGIN
 DELETE FROM bf_preparations WHERE id IN (
  SELECT preparation_id FROM bf_preparation_imports WHERE project_id=OLD.id
 );
END;
