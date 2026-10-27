import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail, type Source } from '../query/types'
import type { executePreparation } from './execute'

/** Retain only the latest failed draft diagnostic, never prepared rows. */
export async function preparationCheckStatements(env:Bindings,ownerId:string,id:string,sources:Source[],result:ReturnType<typeof executePreparation>) {
 const count=await env.DB.prepare('SELECT count(*) AS n FROM bf_preparation_checks WHERE owner_id=? AND preparation_id<>?').bind(ownerId,id).first<{n:number}>()
 if(!result.compatible&&(count?.n??0)>=100)fail('preparation_check_limit',413)
 return [sql('DELETE FROM bf_preparation_checks WHERE owner_id=? AND preparation_id=?',ownerId,id),...result.error?[
  sql('INSERT INTO bf_preparation_checks(owner_id,preparation_id,dataset_id,error_json) VALUES(?,?,?,?)',ownerId,id,sources[0].id,canonicalJson(result.error)),
  ...sources.map(s=>sql('INSERT INTO bf_preparation_check_sources(owner_id,preparation_id,dataset_id,revision) VALUES(?,?,?,?)',ownerId,id,s.id,s.revision))
 ]:[]]
}
export async function chartPreparationErrors(env:Bindings,ownerId:string,snapshotId:string) {
 return (await env.DB.prepare(`WITH RECURSIVE outputs(dataset_id,preparation_id) AS (
  SELECT dataset_id,preparation_id FROM bf_preparation_outputs WHERE owner_id=?
  UNION SELECT s.output_id,o.preparation_id FROM bf_preparation_output_sources s JOIN outputs o ON s.dataset_id=o.dataset_id
 ) SELECT DISTINCT c.preparation_id,c.error_json FROM bf_preparation_checks c
  JOIN bf_query_sources q ON q.snapshot_id=? AND (q.dataset_id=c.dataset_id OR EXISTS(
   SELECT 1 FROM outputs o WHERE o.dataset_id=q.dataset_id AND o.preparation_id=c.preparation_id))
  WHERE c.owner_id=? AND NOT EXISTS(SELECT 1 FROM bf_preparation_check_sources s
   LEFT JOIN bf_file_tables f ON f.id=s.dataset_id AND f.revision=s.revision
   WHERE s.owner_id=c.owner_id AND s.preparation_id=c.preparation_id AND f.id IS NULL)
  ORDER BY c.preparation_id LIMIT 100`).bind(ownerId,snapshotId,ownerId).all<{preparation_id:string;error_json:string}>()).results.map(row=>({preparationId:row.preparation_id,...JSON.parse(row.error_json),publishedChanged:false}))
}
