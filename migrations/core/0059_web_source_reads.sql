-- Read consent and cancellation metadata; no grants, URLs or source rows.
CREATE TABLE bf_web_reads (
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,dataset_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reading','staged','failed','cancelled')),
 started_at INTEGER NOT NULL,finished_at INTEGER
);
