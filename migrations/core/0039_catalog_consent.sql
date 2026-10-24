-- Retained consent must be renewed against the named-data disclosure.
ALTER TABLE bf_catalog_policy ADD COLUMN disclosure_version INTEGER NOT NULL DEFAULT 0;
