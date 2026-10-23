-- Reviewed owner-held reporting packages. No audience or credential grants.
CREATE TABLE bf_reporting_apps (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1, version_counter INTEGER NOT NULL DEFAULT 0,
 draft_json TEXT CHECK(draft_json IS NULL OR json_valid(draft_json)),
 published_version TEXT, created_at TEXT NOT NULL
);
CREATE TABLE bf_reporting_versions (
 id TEXT PRIMARY KEY NOT NULL, app_id TEXT NOT NULL REFERENCES bf_reporting_apps(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL, content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 digest TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(app_id,ordinal)
);
CREATE TABLE bf_reporting_dependencies (
 version_id TEXT NOT NULL REFERENCES bf_reporting_versions(id) ON DELETE CASCADE,
 snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 PRIMARY KEY(version_id,snapshot_id)
);
CREATE TABLE bf_reporting_draft_dependencies (
 app_id TEXT NOT NULL REFERENCES bf_reporting_apps(id) ON DELETE CASCADE,
 snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 PRIMARY KEY(app_id,snapshot_id)
);
CREATE TABLE bf_reporting_events (
 id TEXT PRIMARY KEY NOT NULL, app_id TEXT NOT NULL REFERENCES bf_reporting_apps(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('draft','publish','rollback')),
 version_id TEXT REFERENCES bf_reporting_versions(id) ON DELETE SET NULL,
 actor_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(app_id,generation)
);
CREATE TRIGGER bf_reporting_version_immutable BEFORE UPDATE ON bf_reporting_versions BEGIN SELECT RAISE(ABORT,'immutable_reporting_version'); END;
CREATE TRIGGER bf_reporting_version_withdraw BEFORE DELETE ON bf_reporting_versions BEGIN
 UPDATE bf_reporting_apps SET published_version=NULL,generation=generation+1 WHERE published_version=OLD.id;
END;
CREATE TRIGGER bf_reporting_source_withdraw BEFORE DELETE ON bf_query_snapshots BEGIN
 UPDATE bf_reporting_apps SET draft_json=NULL,generation=generation+1 WHERE id IN (SELECT app_id FROM bf_reporting_draft_dependencies WHERE snapshot_id=OLD.id);
 DELETE FROM bf_reporting_versions WHERE id IN (SELECT version_id FROM bf_reporting_dependencies WHERE snapshot_id=OLD.id);
END;
