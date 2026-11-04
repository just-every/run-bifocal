import type { MigrationProject } from '../compile'
import { assertion, sql } from '../../../../modules/import-kit/src/door/store.ts'
/** Invalid drafts still owe custody to explicitly named native sources. */
export function sourceLinks(project:MigrationProject):string[]{
 const ids=new Set<string>()
 if(project.source==='looker-studio')for(const entry of project.items.filter(i=>i.source.kind==='dashboard'))for(const document of [entry.native,entry.source.original,entry.conflict?.original]){
  try{for(const view of JSON.parse(document??'null')?.definition?.views??[])if(typeof view?.query?.dataset==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(view.query.dataset))ids.add(view.query.dataset)}catch{}
 }
 return [...ids]
}
export const sourceLinkStatements=(project:MigrationProject)=>sourceLinks(project).flatMap(dataset=>[
 assertion(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?) AND NOT EXISTS(SELECT 1 FROM bf_preparation_erasing WHERE dataset_id=?)',dataset,dataset)),
 sql('INSERT OR IGNORE INTO bf_looker_sources(project_id,dataset_id) VALUES(?,?)',project.id,dataset),
])
