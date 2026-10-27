import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { readImportedProject, projectGuard } from '../imports/models/store.server'
import { compileProject } from '../imports/models/compile'
import { fail, type Source } from '../query/types'
import type { Preparation } from './execute'

/** Imported provenance is checked again on native review, save and restore. */
export async function preparationImportGuards(env:Bindings,ownerId:string,document:Preparation){
 if(!document.imported)return []
 const ref=document.imported,current=await readImportedProject(env,ownerId,ref.project)
 if(current.revision!==ref.revision)fail('preparation_import_revision_changed',409)
 const rows=(await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables ORDER BY id LIMIT 101').all<Omit<Source,'table'>>()).results
 if(rows.length>100)fail('model_source_catalog_limit',413)
 const sources=rows.map(row=>({...row,table:JSON.parse(row.value_json)}))
 for(const pin of current.value.sources)if(!sources.some(s=>s.id===pin.id&&s.revision===pin.revision))fail('preparation_import_source_changed',409)
 const compiled=compileProject(current.value.input,ref.project,ownerId,sources)
 if(!compiled.report.compatible||!compiled.preparation?.some(f=>f.id===ref.flow&&f.compatible))fail('unresolved_preparation_import',409)
 return [projectGuard(current),...current.value.sources.map(s=>sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=?)',s.id,s.revision))]
}
