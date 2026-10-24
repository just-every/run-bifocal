import type { D1TargetAdapter } from '../../../modules/import-kit/src/d1/types.ts'
import type { TargetRow } from '../../../modules/import-kit/src/types.ts'
import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { assertion, sql } from '../../../modules/import-kit/src/door/store.ts'
import type { Library } from './types'
export type LibraryRow={id:string;owner_id:string;revision:string;value_json:string}
export const calculationDestination=(id:string)=>'bifocal:calculations:'+id
const valid=(destination:string,kind:string,id:string)=>/^[a-z][a-z0-9-]{0,63}$/.test(id)&&destination===calculationDestination(id)&&kind==='calculation-library'
const native=(r:LibraryRow):TargetRow=>({destination:calculationDestination(r.id),targetKind:'calculation-library',targetId:r.id,revision:r.revision,value:JSON.parse(r.value_json)})
export const calculationTargets:D1TargetAdapter={
 async read(db,destination,kind,id){if(!valid(destination,kind,id))return;const row=await db.prepare('SELECT * FROM bf_calculation_libraries WHERE id=?').bind(id).first<LibraryRow>();return row?native(row):undefined},
 matches(row,destination,kind,id){if(!valid(destination,kind,id))return sql('0');return row?sql('EXISTS(SELECT 1 FROM bf_calculation_libraries WHERE id=? AND revision=? AND value_json=?)',id,row.revision,canonicalJson(row.value)):sql('NOT EXISTS(SELECT 1 FROM bf_calculation_libraries WHERE id=?)',id)},
 matchesCount(count,destination){const id=destination.slice('bifocal:calculations:'.length);return valid(destination,'calculation-library',id)?sql('(SELECT count(*) FROM bf_calculation_libraries WHERE id=?)=?',id,count):sql('0')},
 matchesMany(rows,destination){const id=destination.slice('bifocal:calculations:'.length);return !valid(destination,'calculation-library',id)||rows.some(r=>r.targetId!==id||r.targetKind!=='calculation-library'||r.destination!==destination)?[sql('0')]:[calculationTargets.matchesCount!(rows.length,destination),...rows.map(r=>calculationTargets.matches(r,destination,'calculation-library',id))]},
 write(row){if(!valid(row.destination,row.targetKind,row.targetId))throw Error('CALCULATION_IMPORT_TARGET_SCOPE');const v=row.value as unknown as Library;return [...v.guards.map(assertion),sql('INSERT INTO bf_calculation_libraries(id,owner_id,value_json,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision',row.targetId,v.ownerId,canonicalJson(row.value),row.revision),sql('INSERT OR IGNORE INTO bf_calculation_models(library_id,model_id) VALUES(?,?)',row.targetId,v.input.modelId),...v.sources.map(s=>sql('INSERT OR IGNORE INTO bf_calculation_sources(library_id,dataset_id) VALUES(?,?)',row.targetId,s.id))]},
 remove(destination,kind,id){return valid(destination,kind,id)?[sql('DELETE FROM bf_calculation_libraries WHERE id=?',id)]:[sql('SELECT 0')]},
 async list(db,destination){const id=destination.slice('bifocal:calculations:'.length);if(!valid(destination,'calculation-library',id))return [];return (await db.prepare('SELECT * FROM bf_calculation_libraries WHERE id=?').bind(id).all<LibraryRow>()).results.map(native)},
}
