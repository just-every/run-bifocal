-- Consent metadata only. Source bytes stay in the reviewed file-door custody.
CREATE TABLE bf_analytics_reads (
 id TEXT NOT NULL,event TEXT NOT NULL CHECK(event IN ('consented','staged','refused','failed')),
 owner TEXT NOT NULL,dataset_id TEXT NOT NULL,fingerprint TEXT NOT NULL,recorded_at TEXT NOT NULL,
 PRIMARY KEY(id,event)
);
CREATE TRIGGER bf_analytics_reads_immutable BEFORE UPDATE ON bf_analytics_reads BEGIN SELECT RAISE(ABORT,'immutable_read_consent'); END;
