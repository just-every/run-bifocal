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
-- Installation-local consent, separate from portable definitions and membership.
CREATE TABLE bf_app_activation (
 app_id TEXT PRIMARY KEY REFERENCES bf_apps(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, owner_version INTEGER NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE bf_app_version_sources (
 app_id TEXT NOT NULL, version INTEGER NOT NULL, dataset_id TEXT NOT NULL,
 revision TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(app_id,version,dataset_id)
);
CREATE TABLE bf_app_version_models (
 app_id TEXT NOT NULL, version INTEGER NOT NULL, model_id TEXT NOT NULL,
 revision TEXT NOT NULL, PRIMARY KEY(app_id,version,model_id)
);
CREATE TABLE bf_app_version_metrics (
 app_id TEXT NOT NULL, version INTEGER NOT NULL, metric_id TEXT NOT NULL,
 revision INTEGER NOT NULL, PRIMARY KEY(app_id,version,metric_id)
);
CREATE TRIGGER bf_app_owner_membership AFTER UPDATE ON oa_operators
 WHEN new.version<>old.version OR new.status<>old.status OR new.role<>old.role BEGIN
 DELETE FROM bf_app_activation WHERE app_id IN (SELECT id FROM bf_apps WHERE owner_id=new.id);
END;
CREATE TRIGGER bf_app_source_revision AFTER UPDATE ON bf_file_tables
 WHEN new.revision<>old.revision OR new.value_json<>old.value_json BEGIN
 DELETE FROM bf_app_activation WHERE app_id IN (SELECT app_id FROM bf_app_version_sources WHERE dataset_id=new.id);
END;
CREATE TRIGGER bf_app_source_removed BEFORE DELETE ON bf_file_tables BEGIN
 DELETE FROM bf_app_activation WHERE app_id IN (SELECT app_id FROM bf_app_version_sources WHERE dataset_id=old.id);
END;
CREATE TRIGGER bf_app_model_revision AFTER UPDATE OF production ON bf_semantic_models WHEN new.production IS NOT old.production BEGIN
 DELETE FROM bf_app_activation WHERE app_id IN (SELECT app_id FROM bf_app_version_models WHERE model_id=new.id);
END;
CREATE TRIGGER bf_app_model_removed BEFORE DELETE ON bf_semantic_models BEGIN
 DELETE FROM bf_app_activation WHERE app_id IN (SELECT app_id FROM bf_app_version_models WHERE model_id=old.id);
END;
CREATE TRIGGER bf_app_metric_revision AFTER UPDATE ON bf_metrics
 WHEN new.published_revision IS NOT old.published_revision OR new.deprecated_at IS NOT old.deprecated_at BEGIN
 DELETE FROM bf_app_activation WHERE app_id IN (SELECT app_id FROM bf_app_version_metrics WHERE metric_id=new.id);
END;
CREATE TRIGGER bf_app_metric_removed BEFORE DELETE ON bf_metrics BEGIN
 DELETE FROM bf_app_activation WHERE app_id IN (SELECT app_id FROM bf_app_version_metrics WHERE metric_id=old.id);
END;
-- Pending subscriptions cannot resume automatically after source authority ends.
CREATE TRIGGER bf_app_source_subscription_revision AFTER UPDATE ON bf_file_tables
 WHEN new.revision<>old.revision OR new.value_json<>old.value_json BEGIN
 UPDATE bf_app_subscriptions SET ended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),ended_reason='source-authority-changed'
 WHERE ended_at IS NULL AND app_id IN (SELECT app_id FROM bf_app_version_sources WHERE dataset_id=new.id);
END;
CREATE TRIGGER bf_app_source_subscription_removed BEFORE DELETE ON bf_file_tables BEGIN
 UPDATE bf_app_subscriptions SET ended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),ended_reason='source-erased'
 WHERE ended_at IS NULL AND app_id IN (SELECT app_id FROM bf_app_version_sources WHERE dataset_id=old.id);
END;
CREATE TRIGGER bf_app_model_subscription_revision AFTER UPDATE OF production ON bf_semantic_models WHEN new.production IS NOT old.production BEGIN
 UPDATE bf_app_subscriptions SET ended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),ended_reason='model-authority-changed'
 WHERE ended_at IS NULL AND app_id IN (SELECT app_id FROM bf_app_version_models WHERE model_id=new.id);
END;
-- Short-lived reader context cannot transfer or outlive a published app version.
CREATE TABLE bf_app_dashboard_contexts (
 id TEXT PRIMARY KEY, app_id TEXT NOT NULL, app_version INTEGER NOT NULL, operator_id TEXT NOT NULL,
 audience TEXT NOT NULL, source_page TEXT NOT NULL, target_page TEXT NOT NULL, context_json TEXT NOT NULL, expires_at TEXT NOT NULL
);
