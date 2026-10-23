-- No grant or result bytes: exact consent and acknowledgement metadata only.
CREATE TABLE bf_warehouse_exports (
 id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,board_id TEXT,
 destination_json TEXT NOT NULL CHECK(json_valid(destination_json)),
 fingerprint TEXT NOT NULL,row_count INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('review','sending','acknowledged','partial','unknown')),
 created_at TEXT NOT NULL,settled_at TEXT
);
CREATE INDEX bf_warehouse_exports_owner ON bf_warehouse_exports(owner_id,created_at);
