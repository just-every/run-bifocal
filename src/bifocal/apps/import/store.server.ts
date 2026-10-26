import type { Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { retireD1ImportCustody, sha256, canonicalJson } from '../../../modules/import-kit/src/d1/index.ts'
import type { D1Sql, D1ImportContext } from '../../../modules/import-kit/src/d1/types.ts'
import { fail } from '../../query/types'
import type { AppImport } from './compile'
import { appImportDestination, appImportTargets, type ImportRow } from './targets'
type Owner=D1Sql&{email:string}
export async function readAppImport(env:Bindings,ownerId:string,id:string){
 const row=await env.DB.prepare('SELECT * FROM bf_app_imports WHERE id=? AND owner_id=?').bind(id,ownerId).first<ImportRow>()
 if(!row)fail('app_import_not_found',404)
 return {...row,value:JSON.parse(row.value_json) as AppImport}
}
export const importGuard=(row:ImportRow)=>sql('EXISTS(SELECT 1 FROM bf_app_imports WHERE id=? AND owner_id=? AND revision=? AND value_json=?)',row.id,row.owner_id,row.revision,row.value_json)
export const appImportContext=(env:Bindings,owner:Owner,id:string):D1ImportContext=>({destination:appImportDestination(id),namespace:'app-imports:'+id,mappingVersion:'power-bi-app-v1',storage:{database:env.DB,targets:appImportTargets},authorization:{principalId:'role:owner',predicate:()=>owner}})
export async function eraseAppImport(env:Bindings,owner:Owner,id:string,guards:D1Sql[]=[]){
 const state=await env.DB.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first<{source_identity:string}>(),identity=state?.source_identity??crypto.randomUUID()
 const checkpoint=[sql('INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)',identity),assertion(sql('EXISTS(SELECT 1 FROM rer_portability_state WHERE id=1 AND source_identity=?)',identity)),sql('INSERT OR IGNORE INTO rer_portability_journal(source,tombstone) VALUES(?,?)',identity,sha256(canonicalJson([identity,'rer_portability_state',{id:1}]))),sql('UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1'),sql('INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)')]
 return retireD1ImportCustody({target:{kind:'power-bi-app',id}},[...guards.map(assertion),sql('DELETE FROM bf_app_imports WHERE id=?',id)],appImportContext(env,owner,id),checkpoint)
}
