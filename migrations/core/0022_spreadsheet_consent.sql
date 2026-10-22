-- Consent/audit metadata only: no grant, URL, workbook coordinates or cell value.
CREATE TABLE bf_spreadsheet_reads (
 id TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('consented','staged','refused','failed')),
 owner TEXT NOT NULL,
 dataset_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 request_fingerprint TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(id,event)
);
CREATE TRIGGER bf_spreadsheet_reads_immutable BEFORE UPDATE ON bf_spreadsheet_reads
 BEGIN SELECT RAISE(ABORT,'spreadsheet consent events are immutable'); END;
