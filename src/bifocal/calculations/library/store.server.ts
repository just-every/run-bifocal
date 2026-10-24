import type { Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { retireD1ImportCustody, sha256, canonicalJson } from '../../../modules/import-kit/src/d1/index.ts'
import type { D1Sql, D1ImportContext } from '../../../modules/import-kit/src/d1/types.ts'
import { calculationDestination, calculationTargets, type LibraryRow } from './targets'
import type { Library } from './types'
import { fail } from '../../query/types'
type Owner=D1Sql&{email:string}
export async function readCalculationLibrary(env:Bindings,ownerId:string,id:string){
 const row=await env.DB.prepare('SELECT * FROM bf_calculation_libraries WHERE id=? AND owner_id=?').bind(id,ownerId).first<LibraryRow>()
 if(!row)fail('calculation_library_not_found',404)
 return {...row,value:JSON.parse(row.value_json) as Library}
}
export const libraryGuard=(row:LibraryRow)=>sql('EXISTS(SELECT 1 FROM bf_calculation_libraries WHERE id=? AND owner_id=? AND revision=? AND value_json=?)',row.id,row.owner_id,row.revision,row.value_json)
export const calculationImportContext=(env:Bindings,owner:Owner,id:string):D1ImportContext=>({destination:calculationDestination(id),namespace:'calculations:'+id,mappingVersion:'calculation-library-v1',storage:{database:env.DB,targets:calculationTargets},authorization:{principalId:'role:owner',predicate:()=>owner}})
export async function eraseCalculationLibrary(env:Bindings,owner:Owner,id:string,guards:D1Sql[]=[]){
 const state=await env.DB.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first<{source_identity:string}>(),identity=state?.source_identity??crypto.randomUUID()
 const checkpoint=[sql('INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)',identity),assertion(sql('EXISTS(SELECT 1 FROM rer_portability_state WHERE id=1 AND source_identity=?)',identity)),sql('INSERT OR IGNORE INTO rer_portability_journal(source,tombstone) VALUES(?,?)',identity,sha256(canonicalJson([identity,'rer_portability_state',{id:1}]))),sql('UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1'),sql('INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)')]
 return retireD1ImportCustody({target:{kind:'calculation-library',id}},[...guards.map(assertion),sql('DELETE FROM bf_calculation_runs WHERE library_id=?',id),sql('DELETE FROM bf_calculation_libraries WHERE id=?',id),sql('DELETE FROM bf_calculation_sources WHERE library_id=?',id),sql('DELETE FROM bf_calculation_models WHERE library_id=?',id)],calculationImportContext(env,owner,id),checkpoint)
}
/** Source erasure also retires original calculation libraries from every imported
 * version, including libraries whose current version was replaced or undone. */
export async function eraseSourceCalculationLibraries(env:Bindings,owner:Owner,dataset:string,sourceGuard:D1Sql){
 const rows=(await env.DB.prepare('SELECT DISTINCT library_id FROM bf_calculation_sources WHERE dataset_id=? ORDER BY library_id LIMIT 101').bind(dataset).all<{library_id:string}>()).results
 if(rows.length>100)fail('calculation_library_erasure_limit',413)
 await transact(env.DB,owner,[assertion(sourceGuard)])
 const receipts=[]
 for(const row of rows)receipts.push(await eraseCalculationLibrary(env,owner,row.library_id,[sourceGuard]))
 return receipts
}

export async function eraseModelCalculationLibraries(env:Bindings,owner:Owner,project:string){
 const rows=(await env.DB.prepare('SELECT DISTINCT c.library_id FROM bf_calculation_models c JOIN bf_semantic_revisions r ON r.model_id=c.model_id JOIN bf_model_revision_imports i ON i.revision_id=r.id WHERE i.project_id=? LIMIT 101').bind(project).all<{library_id:string}>()).results
 if(rows.length>100)fail('calculation_library_erasure_limit',413)
 for(const row of rows)await eraseCalculationLibrary(env,owner,row.library_id)
}
