import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { DoorError } from '../../modules/import-kit/src/door/protocol.ts'

/** Refuse the complete withdrawal before fencing any source or project. A
 * project can retain outputs from several bindings and earlier draft versions.
 * UNION terminates shared custody cycles without omitting a retained branch. */
export async function preparationErasureGuard(env:Bindings,kind:'dataset'|'project',id:string) {
 const guard=sql(`NOT EXISTS(WITH RECURSIVE withdrawal(kind,id) AS (
  SELECT ?,?
  UNION SELECT 'dataset',p.output_id FROM bf_preparation_output_sources p JOIN withdrawal w ON w.kind='dataset' AND p.dataset_id=w.id
  UNION SELECT 'project',p.project_id FROM bf_model_import_sources p JOIN withdrawal w ON w.kind='dataset' AND p.dataset_id=w.id
  UNION SELECT 'dataset',o.dataset_id FROM bf_preparation_outputs o JOIN withdrawal w ON w.kind='project' AND o.project_id=w.id
 ) SELECT 1 FROM withdrawal w JOIN bf_source_retention r ON w.kind='dataset' AND r.dataset_id=w.id
 WHERE r.legal_hold=1 OR r.minimum_retain_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,kind,id)
 if(!await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.params??[]).first())throw new DoorError('retention_hold',423,{reason:'A source or prepared output is protected by a legal hold or minimum retention date. Resolve its protection before erasing; no erasure was started.'})
 return guard
}
