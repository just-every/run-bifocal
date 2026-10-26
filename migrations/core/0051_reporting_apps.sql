-- Curated reporting apps: one owner-edited draft, immutable published versions
-- that freeze their content queries, live audience membership bound to the
-- member's current account version, and member subscription definitions.
CREATE TABLE bf_apps (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
 draft_revision INTEGER NOT NULL CHECK(draft_revision>0), head_version INTEGER NOT NULL DEFAULT 0 CHECK(head_version>=0),
 published_version INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE bf_app_versions (
 app_id TEXT NOT NULL REFERENCES bf_apps(id) ON DELETE CASCADE, version INTEGER NOT NULL CHECK(version>0),
 document_json TEXT NOT NULL CHECK(json_valid(document_json)), digest TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('publish','rollback')), restores INTEGER, actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(app_id,version)
);
CREATE TABLE bf_app_members (
 app_id TEXT NOT NULL REFERENCES bf_apps(id) ON DELETE CASCADE, audience TEXT NOT NULL,
 operator_id TEXT NOT NULL, operator_version INTEGER NOT NULL, added_at TEXT NOT NULL,
 PRIMARY KEY(app_id,audience,operator_id)
);
CREATE INDEX bf_app_members_operator ON bf_app_members(operator_id);
CREATE TABLE bf_app_subscriptions (
 id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES bf_apps(id) ON DELETE CASCADE, operator_id TEXT NOT NULL,
 audience TEXT NOT NULL, page_key TEXT NOT NULL, created_at TEXT NOT NULL, ended_at TEXT, ended_reason TEXT
);
CREATE INDEX bf_app_subscriptions_operator ON bf_app_subscriptions(operator_id);
CREATE TABLE bf_app_audit (
 id TEXT PRIMARY KEY, app_id TEXT NOT NULL, owner_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
 subject TEXT, version INTEGER, digest TEXT, recorded_at TEXT NOT NULL
);
-- Reviewed Power BI app definitions: inactive mappings, never credentials.
CREATE TABLE bf_app_imports (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, value_json TEXT NOT NULL, revision TEXT NOT NULL
);
CREATE TRIGGER bf_app_version_immutable BEFORE UPDATE ON bf_app_versions BEGIN SELECT RAISE(ABORT,'immutable_app_version'); END;
CREATE TRIGGER bf_app_audit_immutable BEFORE UPDATE ON bf_app_audit BEGIN SELECT RAISE(ABORT,'immutable_app_audit'); END;
-- A membership change ends every audience access and subscription of that account;
-- reactivation never revives either.
CREATE TRIGGER bf_app_membership AFTER UPDATE ON oa_operators WHEN new.version<>old.version OR new.status<>old.status OR new.role<>old.role BEGIN
 UPDATE bf_app_subscriptions SET ended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),ended_reason='membership-changed' WHERE operator_id=new.id AND ended_at IS NULL;
 DELETE FROM bf_app_members WHERE operator_id=new.id;
END;
