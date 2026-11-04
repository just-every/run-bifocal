-- Keep source custody links across delta imports and Undo until explicit erasure.
CREATE TABLE bf_looker_sources (
 project_id TEXT NOT NULL,
 dataset_id TEXT NOT NULL,
 PRIMARY KEY(project_id,dataset_id)
);
CREATE INDEX bf_looker_sources_dataset ON bf_looker_sources(dataset_id);
