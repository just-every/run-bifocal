-- Permanent source links cover planned, replaced and undone Tableau originals.
CREATE TABLE bf_tableau_migration_sources (
 project_id TEXT NOT NULL,
 dataset_id TEXT NOT NULL,
 PRIMARY KEY(project_id,dataset_id)
);
CREATE TABLE bf_tableau_migration_drafts (
 project_id TEXT NOT NULL REFERENCES bf_migration_projects(id) ON DELETE CASCADE,
 metric_id TEXT NOT NULL REFERENCES bf_metrics(id) ON DELETE CASCADE,
 PRIMARY KEY(project_id,metric_id)
);
