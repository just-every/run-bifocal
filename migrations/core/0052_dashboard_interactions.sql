-- Personal dashboard choices never move publication pointers or carry authority.
CREATE TABLE bf_dashboard_reader_bookmarks (
 dashboard_id TEXT NOT NULL REFERENCES bf_dashboard_definitions(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT 'native', name TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 published_revision INTEGER NOT NULL, selection_json TEXT NOT NULL CHECK(json_valid(selection_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(dashboard_id,operator_id,scope_id,name,revision)
);
CREATE TRIGGER bf_dashboard_reader_bookmark_immutable BEFORE UPDATE ON bf_dashboard_reader_bookmarks BEGIN SELECT RAISE(ABORT,'immutable_dashboard_reader_bookmark'); END;
-- Named drillthrough context is exact, short-lived, audience-local and carries
-- only filter definitions. Every destination read still needs current authority.
CREATE TABLE bf_dashboard_reader_contexts (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL,
 source_id TEXT NOT NULL REFERENCES bf_dashboard_definitions(id) ON DELETE CASCADE,
 source_revision INTEGER NOT NULL, target_id TEXT NOT NULL REFERENCES bf_dashboard_definitions(id) ON DELETE CASCADE,
 target_revision INTEGER NOT NULL, context_json TEXT NOT NULL CHECK(json_valid(context_json)), expires_at TEXT NOT NULL
);
CREATE TRIGGER bf_dashboard_reader_membership AFTER UPDATE ON oa_operators WHEN new.version<>old.version OR new.status<>old.status OR new.role<>old.role BEGIN
 DELETE FROM bf_dashboard_reader_contexts WHERE operator_id=new.id;
 DELETE FROM bf_dashboard_reader_bookmarks WHERE operator_id=new.id;
END;
