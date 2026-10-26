import type { D1TargetAdapter } from '../../../modules/import-kit/src/d1/types.ts'
import type { TargetRow } from '../../../modules/import-kit/src/types.ts'
import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { sql } from '../../../modules/import-kit/src/door/store.ts'
import type { AppImport } from './compile'
export type ImportRow={id:string;owner_id:string;revision:string;value_json:string}
export const appImportDestination=(id:string)=>'bifocal:app-imports:'+id
const valid=(destination:string,kind:string,id:string)=>/^[a-z][a-z0-9-]{0,63}$/.test(id)&&destination===appImportDestination(id)&&kind==='power-bi-app'
const native=(r:ImportRow):TargetRow=>({destination:appImportDestination(r.id),targetKind:'power-bi-app',targetId:r.id,revision:r.revision,value:JSON.parse(r.value_json)})
export const appImportTargets:D1TargetAdapter={
 async read(db,destination,kind,id){if(!valid(destination,kind,id))return;const row=await db.prepare('SELECT * FROM bf_app_imports WHERE id=?').bind(id).first<ImportRow>();return row?native(row):undefined},
 matches(row,destination,kind,id){if(!valid(destination,kind,id))return sql('0');return row?sql('EXISTS(SELECT 1 FROM bf_app_imports WHERE id=? AND revision=? AND value_json=?)',id,row.revision,canonicalJson(row.value)):sql('NOT EXISTS(SELECT 1 FROM bf_app_imports WHERE id=?)',id)},
 matchesCount(count,destination){const id=destination.slice('bifocal:app-imports:'.length);return valid(destination,'power-bi-app',id)?sql('(SELECT count(*) FROM bf_app_imports WHERE id=?)=?',id,count):sql('0')},
 matchesMany(rows,destination){const id=destination.slice('bifocal:app-imports:'.length);return !valid(destination,'power-bi-app',id)||rows.some(r=>r.targetId!==id||r.targetKind!=='power-bi-app'||r.destination!==destination)?[sql('0')]:[appImportTargets.matchesCount!(rows.length,destination),...rows.map(r=>appImportTargets.matches(r,destination,'power-bi-app',id))]},
 write(row){if(!valid(row.destination,row.targetKind,row.targetId))throw Error('APP_IMPORT_TARGET_SCOPE');const v=row.value as unknown as AppImport;return [sql('INSERT INTO bf_app_imports(id,owner_id,value_json,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision',row.targetId,v.ownerId,canonicalJson(row.value),row.revision)]},
 remove(destination,kind,id){return valid(destination,kind,id)?[sql('DELETE FROM bf_app_imports WHERE id=?',id)]:[sql('SELECT 0')]},
 async list(db,destination){const id=destination.slice('bifocal:app-imports:'.length);if(!valid(destination,'power-bi-app',id))return [];return (await db.prepare('SELECT * FROM bf_app_imports WHERE id=?').bind(id).all<ImportRow>()).results.map(native)},
}
