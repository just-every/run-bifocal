import type { D1TargetAdapter } from '../../../modules/import-kit/src/d1/types.ts'
import type { TargetRow } from '../../../modules/import-kit/src/types.ts'
import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { assertion, sql } from '../../../modules/import-kit/src/door/store.ts'
import type { CompiledProject } from './compile'
export type ProjectRow={id:string;owner_id:string;revision:string;value_json:string}
export const modelDestination=(id:string)=>'bifocal:models:'+id
const valid=(destination:string,kind:string,id:string)=>/^[a-z][a-z0-9-]{0,63}$/.test(id)&&destination===modelDestination(id)&&kind==='model-project'
const native=(r:ProjectRow):TargetRow=>({destination:modelDestination(r.id),targetKind:'model-project',targetId:r.id,revision:r.revision,value:JSON.parse(r.value_json)})
export const modelImportTargets:D1TargetAdapter={
 async read(db,destination,kind,id){if(!valid(destination,kind,id))return;const row=await db.prepare('SELECT * FROM bf_model_imports WHERE id=?').bind(id).first<ProjectRow>();return row?native(row):undefined},
 matches(row,destination,kind,id){if(!valid(destination,kind,id))return sql('0');return row?sql('EXISTS(SELECT 1 FROM bf_model_imports WHERE id=? AND revision=? AND value_json=?)',id,row.revision,canonicalJson(row.value)):sql('NOT EXISTS(SELECT 1 FROM bf_model_imports WHERE id=?)',id)},
 matchesCount(count,destination){const id=destination.slice('bifocal:models:'.length);return valid(destination,'model-project',id)?sql('(SELECT count(*) FROM bf_model_imports WHERE id=?)=?',id,count):sql('0')},
 matchesMany(rows,destination){const id=destination.slice('bifocal:models:'.length);return !valid(destination,'model-project',id)||rows.some(r=>r.targetId!==id||r.targetKind!=='model-project'||r.destination!==destination)?[sql('0')]:[modelImportTargets.matchesCount!(rows.length,destination),...rows.map(r=>modelImportTargets.matches(r,destination,'model-project',id))]},
 write(row){if(!valid(row.destination,row.targetKind,row.targetId))throw Error('MODEL_IMPORT_TARGET_SCOPE');const v=row.value as unknown as CompiledProject;return [...v.sources.map(s=>assertion(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=?)',s.id,s.revision))),sql('INSERT INTO bf_model_imports(id,owner_id,value_json,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision',row.targetId,v.ownerId,canonicalJson(row.value),row.revision),...v.sources.map(s=>sql('INSERT OR IGNORE INTO bf_model_import_sources(project_id,dataset_id) VALUES(?,?)',row.targetId,s.id))]},
 remove(destination,kind,id){return valid(destination,kind,id)?[sql('DELETE FROM bf_model_imports WHERE id=?',id)]:[sql('SELECT 0')]},
 async list(db,destination){const id=destination.slice('bifocal:models:'.length);if(!valid(destination,'model-project',id))return [];return (await db.prepare('SELECT * FROM bf_model_imports WHERE id=?').bind(id).all<ProjectRow>()).results.map(native)},
}
