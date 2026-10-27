CREATE TABLE bf_collaboration_subjects (
 key TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bf_collaboration_sources (
 subject_key TEXT NOT NULL REFERENCES bf_collaboration_subjects(key) ON DELETE CASCADE,
 dataset_id TEXT NOT NULL, PRIMARY KEY(subject_key,dataset_id)
);
CREATE TABLE bf_collaboration_comments (
 id TEXT PRIMARY KEY, subject_key TEXT NOT NULL REFERENCES bf_collaboration_subjects(key) ON DELETE CASCADE,
 author_id TEXT NOT NULL, body TEXT NOT NULL, point INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE bf_collaboration_links (
 id TEXT PRIMARY KEY, subject_key TEXT NOT NULL REFERENCES bf_collaboration_subjects(key) ON DELETE CASCADE,
 issuer_id TEXT NOT NULL, issuer_version INTEGER NOT NULL, recipient_id TEXT NOT NULL, recipient_version INTEGER NOT NULL,
 expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE bf_collaboration_notifications (
 id TEXT PRIMARY KEY, comment_id TEXT NOT NULL REFERENCES bf_collaboration_comments(id) ON DELETE CASCADE,
 link_id TEXT NOT NULL REFERENCES bf_collaboration_links(id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bf_collaboration_annotations (
 id TEXT PRIMARY KEY, metric_id TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL,
 point TEXT NOT NULL, body TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(metric_id,revision) REFERENCES bf_metric_revisions(metric_id,revision) ON DELETE CASCADE
);
CREATE TABLE bf_collaboration_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TRIGGER bf_collaboration_source_changed AFTER UPDATE ON bf_file_tables BEGIN
 UPDATE bf_collaboration_subjects SET active=0 WHERE key IN (SELECT subject_key FROM bf_collaboration_sources WHERE dataset_id=NEW.id);
 UPDATE bf_collaboration_links SET revoked=1 WHERE subject_key IN (SELECT subject_key FROM bf_collaboration_sources WHERE dataset_id=NEW.id);
END;
CREATE TRIGGER bf_collaboration_source_erased BEFORE DELETE ON bf_file_tables BEGIN
 DELETE FROM bf_collaboration_subjects WHERE key IN (SELECT subject_key FROM bf_collaboration_sources WHERE dataset_id=OLD.id);
END;
CREATE TRIGGER bf_collaboration_membership AFTER UPDATE ON oa_operators
WHEN NEW.version<>OLD.version OR NEW.status<>OLD.status OR NEW.role<>OLD.role BEGIN
 UPDATE bf_collaboration_links SET revoked=1 WHERE issuer_id=NEW.id OR recipient_id=NEW.id;
END;
CREATE TRIGGER bf_collaboration_member_removed BEFORE DELETE ON oa_operators BEGIN
 UPDATE bf_collaboration_links SET revoked=1 WHERE issuer_id=OLD.id OR recipient_id=OLD.id;
END;
