-- Estate pointers publish an exact reviewed collection of native definitions.
CREATE TABLE bf_environment_estates (
 owner_id TEXT NOT NULL,id TEXT NOT NULL,head_revision INTEGER NOT NULL,
 development INTEGER NOT NULL,staging INTEGER,production INTEGER,generation INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,id)
);
CREATE TABLE bf_environment_revisions (
 owner_id TEXT NOT NULL,estate_id TEXT NOT NULL,revision INTEGER NOT NULL,
 document_json TEXT NOT NULL,definitions_json TEXT NOT NULL,digest TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,estate_id,revision)
);
CREATE TABLE bf_environment_history (
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,estate_id TEXT NOT NULL,revision INTEGER NOT NULL,
 environment TEXT NOT NULL,action TEXT NOT NULL,actor_id TEXT NOT NULL,digest TEXT NOT NULL,recorded_at TEXT NOT NULL
);
-- Approval activation never transfers through an installation archive.
CREATE TABLE bf_environment_approval (
 owner_id TEXT NOT NULL,estate_id TEXT NOT NULL,revision INTEGER NOT NULL,generation INTEGER NOT NULL,
 digest TEXT NOT NULL,security_resolution TEXT,PRIMARY KEY(owner_id,estate_id)
);
CREATE TRIGGER bf_environment_revision_immutable BEFORE UPDATE ON bf_environment_revisions BEGIN SELECT RAISE(ABORT,'immutable_environment_revision'); END;
CREATE TRIGGER bf_environment_history_immutable BEFORE UPDATE ON bf_environment_history BEGIN SELECT RAISE(ABORT,'immutable_environment_history'); END;
CREATE TABLE bf_environment_sources (
 owner_id TEXT NOT NULL,estate_id TEXT NOT NULL,revision INTEGER NOT NULL,dataset_id TEXT NOT NULL,
 PRIMARY KEY(owner_id,estate_id,revision,dataset_id),
 FOREIGN KEY(owner_id,estate_id,revision) REFERENCES bf_environment_revisions(owner_id,estate_id,revision) ON DELETE CASCADE
);
