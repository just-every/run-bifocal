import { eraseModelCalculationLibraries } from '../../calculations/library/store.server'
import type { Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { retireD1ImportCustody, sha256, canonicalJson } from '../../../modules/import-kit/src/d1/index.ts'
import type { D1Sql, D1ImportContext } from '../../../modules/import-kit/src/d1/types.ts'
import { modelDestination, modelImportTargets, type ProjectRow } from './targets'
import type { CompiledProject } from './compile'
import { fail } from '../../query/types'
type Owner=D1Sql&{email:string}
export async function readImportedProject(env:Bindings,ownerId:string,id:string){
 const row=await env.DB.prepare('SELECT * FROM bf_model_imports WHERE id=? AND owner_id=?').bind(id,ownerId).first<ProjectRow>()
 if(!row)fail('model_project_not_found',404)
 return {...row,value:JSON.parse(row.value_json) as CompiledProject}
}
export const projectGuard=(row:ProjectRow)=>sql('EXISTS(SELECT 1 FROM bf_model_imports WHERE id=? AND owner_id=? AND revision=? AND value_json=?)',row.id,row.owner_id,row.revision,row.value_json)
export const modelImportContext=(env:Bindings,owner:Owner,id:string):D1ImportContext=>({destination:modelDestination(id),namespace:'models:'+id,mappingVersion:'model-project-v1',storage:{database:env.DB,targets:modelImportTargets},authorization:{principalId:'role:owner',predicate:()=>owner}})
const modelIds='SELECT r.model_id FROM bf_model_revision_imports i JOIN bf_semantic_revisions r ON r.id=i.revision_id WHERE i.project_id=?'
export async function eraseImportedProject(env:Bindings,owner:Owner,id:string,guards:D1Sql[]=[]){
 await eraseModelCalculationLibraries(env,owner,id)
 const state=await env.DB.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first<{source_identity:string}>(),identity=state?.source_identity??crypto.randomUUID()
 const checkpoint=[sql('INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)',identity),assertion(sql('EXISTS(SELECT 1 FROM rer_portability_state WHERE id=1 AND source_identity=?)',identity)),sql('INSERT OR IGNORE INTO rer_portability_journal(source,tombstone) VALUES(?,?)',identity,sha256(canonicalJson([identity,'rer_portability_state',{id:1}]))),sql('UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1'),sql('INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)')]
 return retireD1ImportCustody({target:{kind:'model-project',id}},[...guards.map(assertion),sql('DELETE FROM bf_query_snapshots WHERE id IN (SELECT snapshot_id FROM bf_model_import_uses WHERE project_id=?)',id),sql(`DELETE FROM bf_semantic_models WHERE id IN (${modelIds})`,id),sql('DELETE FROM bf_model_imports WHERE id=?',id),sql('DELETE FROM bf_model_import_sources WHERE project_id=?',id)],modelImportContext(env,owner,id),checkpoint)
}
/** Source erasure also retires original model projects from every imported
 * version, including projects whose current version was replaced or undone. */
export async function eraseSourceModelProjects(env:Bindings,owner:Owner,dataset:string,sourceGuard:D1Sql){
 const rows=(await env.DB.prepare('SELECT DISTINCT project_id FROM bf_model_import_sources WHERE dataset_id=? ORDER BY project_id LIMIT 101').bind(dataset).all<{project_id:string}>()).results
 if(rows.length>100)fail('model_project_erasure_limit',413)
 await transact(env.DB,owner,[assertion(sourceGuard)])
 const receipts=[]
 for(const row of rows)receipts.push(await eraseImportedProject(env,owner,row.project_id,[sourceGuard]))
 return receipts
}
