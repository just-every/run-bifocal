import type { MigrationProject } from '../compile'
import { assertion, sql } from '../../../../modules/import-kit/src/door/store.ts'
/** Invalid drafts still owe custody to explicitly named native sources. */
export function sourceLinks(project:MigrationProject):string[]{
 const ids=new Set<string>()
 if(project.source==='looker-studio')for(const entry of project.items.filter(i=>i.source.kind==='dashboard'))for(const document of [entry.native,entry.source.original,entry.conflict?.original]){
  try{
   for(const view of JSON.parse(document??'null')?.definition?.views??[]){
    const query=view?.query
    for(const source of [query,...Array.isArray(query?.joins)?query.joins:[]])
     if(typeof source?.dataset==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(source.dataset))ids.add(source.dataset)
   }
  }catch{}
 }
 return [...ids]
}
export const sourceLinkStatements=(project:MigrationProject)=>sourceLinks(project).flatMap(dataset=>[
 assertion(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?) AND NOT EXISTS(SELECT 1 FROM bf_preparation_erasing WHERE dataset_id=?)',dataset,dataset)),
 sql('INSERT OR IGNORE INTO bf_looker_sources(project_id,dataset_id) VALUES(?,?)',project.id,dataset),
])

/** Check every linked source before starting any reconstruction withdrawal. */
export const reconstructionRetentionAllowsErasure=(dataset:string)=>sql(`NOT EXISTS(
 SELECT 1 FROM bf_looker_sources erased JOIN bf_looker_sources linked ON linked.project_id=erased.project_id
 JOIN bf_source_retention retention ON retention.dataset_id=linked.dataset_id
 WHERE erased.dataset_id=? AND (retention.legal_hold=1 OR retention.minimum_retain_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`,dataset)
