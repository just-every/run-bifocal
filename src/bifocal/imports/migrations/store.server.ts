import { retentionAllowsErasure } from '../../retention/policy.server'
import type { Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { retireD1ImportCustody, sha256, canonicalJson } from '../../../modules/import-kit/src/d1/index.ts'
import type { D1Sql, D1ImportContext } from '../../../modules/import-kit/src/d1/types.ts'
import { fail } from '../../query/types'
import type { MigrationProject } from './compile'
import { migrationImportDestination, migrationImportTargets, type ImportRow } from './targets'
export type MigrationRow=ImportRow&{value:MigrationProject}
type Owner=D1Sql&{email:string}
export async function readMigrationProject(env:Bindings,ownerId:string,id:string){
 const row=await env.DB.prepare('SELECT * FROM bf_migration_workspaces WHERE id=? AND owner_id=?').bind(id,ownerId).first<ImportRow>()
 if(!row)fail('migration_project_not_found',404)
 return {...row,value:JSON.parse(row.value_json) as MigrationProject}
}
export const importGuard=(row:ImportRow)=>sql('EXISTS(SELECT 1 FROM bf_migration_workspaces WHERE id=? AND owner_id=? AND revision=? AND value_json=?)',row.id,row.owner_id,row.revision,row.value_json)
export const migrationImportContext=(env:Bindings,owner:Owner,id:string):D1ImportContext=>({destination:migrationImportDestination(id),namespace:'migration-projects:'+id,mappingVersion:'migration-project-v1',storage:{database:env.DB,targets:migrationImportTargets},authorization:{principalId:'role:owner',predicate:()=>owner}})
export async function eraseMigrationProject(env:Bindings,owner:Owner,id:string,guards:D1Sql[]=[]){
 const sources=(await env.DB.prepare('SELECT dataset_id FROM bf_looker_sources WHERE project_id=? UNION SELECT dataset_id FROM bf_tableau_migration_sources WHERE project_id=?').bind(id,id).all<{dataset_id:string}>()).results
 const retention=sources.map(s=>retentionAllowsErasure(s.dataset_id))
 for(const check of retention){const result=await env.DB.prepare('SELECT ('+check.sql+') AS allowed').bind(...check.params??[]).first<{allowed:number}>();if(!result?.allowed)fail('retention_hold',423)}
 const state=await env.DB.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first<{source_identity:string}>(),identity=state?.source_identity??crypto.randomUUID()
 const checkpoint=[sql('INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)',identity),assertion(sql('EXISTS(SELECT 1 FROM rer_portability_state WHERE id=1 AND source_identity=?)',identity)),sql('INSERT OR IGNORE INTO rer_portability_journal(source,tombstone) VALUES(?,?)',identity,sha256(canonicalJson([identity,'rer_portability_state',{id:1}]))),sql('UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1'),sql('INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)')]
 return retireD1ImportCustody({target:{kind:'migration-project',id}},[...guards.map(assertion),...retention.map(assertion),sql('DELETE FROM bf_looker_sources WHERE project_id=?',id),sql('DELETE FROM bf_metrics WHERE id IN (SELECT metric_id FROM bf_tableau_migration_drafts WHERE project_id=?)',id),sql('DELETE FROM bf_migration_projects WHERE id=?',id),sql('DELETE FROM bf_tableau_migration_sources WHERE project_id=?',id)],migrationImportContext(env,owner,id),checkpoint)
}

export async function eraseSourceReconstructions(env:Bindings,owner:Owner,dataset:string,guard:D1Sql){
 const rows=(await env.DB.prepare('SELECT project_id FROM bf_looker_sources WHERE dataset_id=? ORDER BY project_id LIMIT 101').bind(dataset).all<{project_id:string}>()).results
 if(rows.length>100)fail('looker_erasure_limit',413)
 const receipts=[]
 for(const row of rows)receipts.push(await eraseMigrationProject(env,owner,row.project_id,[guard]))
 return receipts
}

/** Decide the whole linked withdrawal before any project is erased. */
export const tableauRetentionAllowsErasure=(dataset:string)=>sql(`NOT EXISTS(
 SELECT 1 FROM bf_tableau_migration_sources erased JOIN bf_tableau_migration_sources linked ON linked.project_id=erased.project_id
 JOIN bf_source_retention retention ON retention.dataset_id=linked.dataset_id
 WHERE erased.dataset_id=? AND (retention.legal_hold=1 OR retention.minimum_retain_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`,dataset)

/** A separately reviewed source owns custody of every planned Tableau version. */
export async function eraseSourceTableauProjects(env:Bindings,owner:Owner,dataset:string,sourceGuard:D1Sql){
 const rows=(await env.DB.prepare('SELECT DISTINCT project_id FROM bf_tableau_migration_sources WHERE dataset_id=? ORDER BY project_id LIMIT 101').bind(dataset).all<{project_id:string}>()).results
 if(rows.length>100)fail('tableau_project_erasure_limit',413)
 const retention=tableauRetentionAllowsErasure(dataset)
 const allowed=await env.DB.prepare('SELECT ('+retention.sql+') AS allowed').bind(...retention.params??[]).first<{allowed:number}>()
 if(!allowed?.allowed)fail('retention_hold',423)
 const receipts=[]
 for(const row of rows)receipts.push(await eraseMigrationProject(env,owner,row.project_id,[sourceGuard,retention]))
 return receipts
}
