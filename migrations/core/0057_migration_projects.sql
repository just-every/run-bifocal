CREATE TABLE bf_migration_projects (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 value_json TEXT NOT NULL,
 revision TEXT NOT NULL
);
CREATE TABLE bf_migration_project_edits (
 project_id TEXT NOT NULL REFERENCES bf_migration_projects(id) ON DELETE CASCADE,
 revision TEXT NOT NULL,
 action TEXT NOT NULL,
 value_json TEXT NOT NULL,
 PRIMARY KEY(project_id,revision)
);
CREATE TABLE bf_migration_workspaces (
 id TEXT PRIMARY KEY REFERENCES bf_migration_projects(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL
);
