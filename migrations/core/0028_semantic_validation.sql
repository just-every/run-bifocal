-- Immutable semantic revisions; one coherent environment pointer and cache epoch.
CREATE TABLE bf_semantic_models (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0,
 production TEXT, staging TEXT, cache_epoch INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE bf_semantic_revisions (
 id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES bf_semantic_models(id),
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), created_at TEXT NOT NULL
);
CREATE TABLE bf_semantic_branches (
 id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES bf_semantic_models(id),
 base_generation INTEGER NOT NULL, revision_id TEXT NOT NULL REFERENCES bf_semantic_revisions(id),
 version INTEGER NOT NULL DEFAULT 1, approval_json TEXT CHECK(approval_json IS NULL OR json_valid(approval_json))
);
CREATE TABLE bf_semantic_history (
 id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES bf_semantic_models(id),
 environment TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES bf_semantic_revisions(id),
 action TEXT NOT NULL, actor_id TEXT NOT NULL, cache_epoch INTEGER NOT NULL,
 recorded_at TEXT NOT NULL
);
CREATE TABLE bf_semantic_cache (
 model_id TEXT NOT NULL, environment TEXT NOT NULL, view_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 epoch INTEGER NOT NULL, PRIMARY KEY(model_id,environment,view_id)
);
CREATE TRIGGER bf_semantic_revision_immutable BEFORE UPDATE ON bf_semantic_revisions BEGIN SELECT RAISE(ABORT,'immutable_semantic_revision'); END;
CREATE TRIGGER bf_semantic_history_immutable BEFORE UPDATE ON bf_semantic_history BEGIN SELECT RAISE(ABORT,'immutable_semantic_history'); END;

CREATE TABLE bf_semantic_approvals (
 id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES bf_semantic_models(id),
 revision_id TEXT NOT NULL REFERENCES bf_semantic_revisions(id), digest TEXT NOT NULL,
 actor_id TEXT NOT NULL, security_resolution TEXT, recorded_at TEXT NOT NULL
);
CREATE TRIGGER bf_semantic_approval_immutable BEFORE UPDATE ON bf_semantic_approvals BEGIN SELECT RAISE(ABORT,'immutable_semantic_approval'); END;
