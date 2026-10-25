-- Grid documents and independently editable phone placement bind real retained
-- dashboard boards. Publication moves one pointer; every draft stays immutable.
CREATE TABLE bf_dashboard_definitions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, head_revision INTEGER NOT NULL CHECK(head_revision>0),
 generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0), published_revision INTEGER
);
CREATE TABLE bf_dashboard_definition_revisions (
 dashboard_id TEXT NOT NULL REFERENCES bf_dashboard_definitions(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 board_id TEXT NOT NULL REFERENCES bf_analytics_boards(id) ON DELETE CASCADE,
 digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(dashboard_id,revision)
);
CREATE TABLE bf_dashboard_definition_history (
 id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL REFERENCES bf_dashboard_definitions(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('draft','publish','rollback')),
 actor_id TEXT NOT NULL, digest TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TRIGGER bf_dashboard_definition_revision_immutable BEFORE UPDATE ON bf_dashboard_definition_revisions BEGIN SELECT RAISE(ABORT,'immutable_dashboard_definition_revision'); END;
CREATE TRIGGER bf_dashboard_definition_history_immutable BEFORE UPDATE ON bf_dashboard_definition_history BEGIN SELECT RAISE(ABORT,'immutable_dashboard_definition_history'); END;
-- Withdrawing any constituent board withdraws all its authored versions and
-- publication metadata, including drafts and historical phone placements.
CREATE TRIGGER bf_dashboard_definition_withdraw BEFORE DELETE ON bf_analytics_boards BEGIN
 DELETE FROM bf_dashboard_definitions WHERE id IN (SELECT dashboard_id FROM bf_dashboard_definition_revisions WHERE board_id=OLD.id);
END;
