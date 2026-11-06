-- Identifying review custody is removed by eligible source erasure. The linked
-- permanent audit keeps only unrelated opaque references, event kind and time.
CREATE TABLE bf_retention_acknowledgments (
 audit_id TEXT PRIMARY KEY REFERENCES bf_erasure_audit(id),
 dataset_id TEXT NOT NULL,
 source_revision TEXT,
 source_state TEXT NOT NULL CHECK(source_state IN ('published','unpublished')),
 approving_owner_id TEXT NOT NULL,
 approving_owner_version INTEGER NOT NULL,
 previous_revision TEXT,
 replacement_revision TEXT NOT NULL UNIQUE,
 before_legal_hold INTEGER CHECK(before_legal_hold IN (0,1)),
 before_minimum_retain_until TEXT,
 after_legal_hold INTEGER NOT NULL CHECK(after_legal_hold IN (0,1)),
 after_minimum_retain_until TEXT,
 release_acknowledged INTEGER NOT NULL CHECK(release_acknowledged IN (0,1)),
 CHECK((source_state='published' AND source_revision IS NOT NULL) OR (source_state='unpublished' AND source_revision IS NULL))
);
CREATE INDEX bf_retention_acknowledgments_source ON bf_retention_acknowledgments(dataset_id);
CREATE TRIGGER bf_retention_acknowledgments_immutable BEFORE UPDATE ON bf_retention_acknowledgments BEGIN SELECT RAISE(ABORT,'immutable_retention_acknowledgment'); END;
CREATE TRIGGER bf_retention_acknowledgments_no_replace BEFORE INSERT ON bf_retention_acknowledgments WHEN EXISTS(SELECT 1 FROM bf_retention_acknowledgments WHERE audit_id=new.audit_id OR replacement_revision=new.replacement_revision) BEGIN SELECT RAISE(ABORT,'immutable_retention_acknowledgment'); END;
