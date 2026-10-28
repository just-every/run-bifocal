-- Execution results are reusable only under an exact, current evidence key.
-- Immutable answers remain independent of this disposable bounded store.
CREATE TABLE bf_query_cache (
 key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, principal_id TEXT NOT NULL,
 answer_json TEXT NOT NULL CHECK(json_valid(answer_json)), digest TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX bf_query_cache_principal ON bf_query_cache(principal_id,created_at);
CREATE TABLE bf_query_cache_sources (
 cache_key TEXT NOT NULL REFERENCES bf_query_cache(key) ON DELETE CASCADE,
 dataset_id TEXT NOT NULL, revision TEXT NOT NULL, fingerprint TEXT NOT NULL,
 PRIMARY KEY(cache_key,dataset_id)
);
CREATE INDEX bf_query_cache_dataset ON bf_query_cache_sources(dataset_id);
ALTER TABLE bf_query_snapshots ADD COLUMN cache_json TEXT CHECK(cache_json IS NULL OR json_valid(cache_json));
