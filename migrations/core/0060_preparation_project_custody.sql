-- Published custody outlives draft revisions and their cascading erasure.
ALTER TABLE bf_preparation_outputs ADD COLUMN project_id TEXT;
UPDATE bf_preparation_outputs SET project_id=(
 SELECT json_extract(r.document_json,'$.imported.projectId')
 FROM bf_preparation_revisions r
 WHERE r.preparation_id=bf_preparation_outputs.preparation_id
 AND r.version=bf_preparation_outputs.version
);
CREATE INDEX bf_preparation_output_project ON bf_preparation_outputs(project_id);
