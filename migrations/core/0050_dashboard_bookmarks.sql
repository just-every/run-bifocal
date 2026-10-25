-- Private reader choices never move a dashboard publication pointer.
CREATE TABLE bf_dashboard_bookmarks (
 dashboard_id TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0 AND revision<=100),
 filters_json TEXT NOT NULL CHECK(json_valid(filters_json)), fields_json TEXT NOT NULL CHECK(json_valid(fields_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(dashboard_id,owner_id,name,revision)
);
CREATE TRIGGER bf_dashboard_bookmark_immutable BEFORE UPDATE ON bf_dashboard_bookmarks BEGIN SELECT RAISE(ABORT,'immutable_dashboard_bookmark'); END;
CREATE TRIGGER bf_dashboard_bookmark_board_withdraw BEFORE DELETE ON bf_analytics_boards BEGIN
 DELETE FROM bf_dashboard_bookmarks WHERE dashboard_id=OLD.id;
END;
CREATE TRIGGER bf_dashboard_bookmark_artifact_withdraw BEFORE DELETE ON bf_query_artifacts BEGIN
 DELETE FROM bf_dashboard_bookmarks WHERE dashboard_id=OLD.id;
END;
