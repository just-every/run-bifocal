-- Preserve source custody for all reviewed versions, including undone plans.
CREATE TABLE bf_migration_sources (
 project_id TEXT NOT NULL,
 dataset_id TEXT NOT NULL,
 PRIMARY KEY(project_id,dataset_id)
);
CREATE TABLE bf_migration_model_revisions (
 revision_id TEXT PRIMARY KEY REFERENCES bf_semantic_revisions(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 project_revision TEXT NOT NULL,
 element_id TEXT NOT NULL
);
CREATE TRIGGER bf_migration_project_erased BEFORE DELETE ON bf_migration_projects BEGIN
 DELETE FROM bf_query_snapshots WHERE json_extract(query_json,'$.context.modelVersion') IN (
  SELECT r.id FROM bf_semantic_revisions r WHERE r.model_id IN (
   SELECT r.model_id FROM bf_migration_model_revisions i JOIN bf_semantic_revisions r ON r.id=i.revision_id WHERE i.project_id=old.id
  )
 );
 DELETE FROM bf_semantic_models WHERE id IN (
  SELECT r.model_id FROM bf_migration_model_revisions i JOIN bf_semantic_revisions r ON r.id=i.revision_id WHERE i.project_id=old.id
 );
 DELETE FROM bf_migration_project_edits WHERE project_id=old.id;
 DELETE FROM bf_migration_workspaces WHERE id=old.id;
END;
