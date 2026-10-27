import type { D1TargetAdapter } from '../../../modules/import-kit/src/d1/types.ts'
import type { TargetRow } from '../../../modules/import-kit/src/types.ts'
import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { sql } from '../../../modules/import-kit/src/door/store.ts'
import type { RdlProject } from './parse'
export type RdlRow={id:string;owner_id:string;revision:string;value_json:string}
export const rdlDestination=(id:string)=>'bifocal:rdl:'+id
const valid=(destination:string,kind:string,id:string)=>/^[a-z][a-z0-9-]{0,63}$/.test(id)&&destination===rdlDestination(id)&&kind==='rdl-project'
const native=(r:RdlRow):TargetRow=>({destination:rdlDestination(r.id),targetKind:'rdl-project',targetId:r.id,revision:r.revision,value:JSON.parse(r.value_json)})
export const rdlImportTargets:D1TargetAdapter={
 async read(db,destination,kind,id){if(!valid(destination,kind,id))return;const row=await db.prepare('SELECT * FROM bf_rdl_imports WHERE id=?').bind(id).first<RdlRow>();return row?native(row):undefined},
 matches(row,destination,kind,id){if(!valid(destination,kind,id))return sql('0');return row?sql('EXISTS(SELECT 1 FROM bf_rdl_imports WHERE id=? AND revision=? AND value_json=?)',id,row.revision,canonicalJson(row.value)):sql('NOT EXISTS(SELECT 1 FROM bf_rdl_imports WHERE id=?)',id)},
 matchesCount(count,destination){const id=destination.slice('bifocal:rdl:'.length);return valid(destination,'rdl-project',id)?sql('(SELECT count(*) FROM bf_rdl_imports WHERE id=?)=?',id,count):sql('0')},
 matchesMany(rows,destination){const id=destination.slice('bifocal:rdl:'.length);return !valid(destination,'rdl-project',id)||rows.some(r=>r.targetId!==id||r.targetKind!=='rdl-project'||r.destination!==destination)?[sql('0')]:[rdlImportTargets.matchesCount!(rows.length,destination),...rows.map(r=>rdlImportTargets.matches(r,destination,'rdl-project',id))]},
 write(row){if(!valid(row.destination,row.targetKind,row.targetId))throw Error('RDL_IMPORT_TARGET_SCOPE');const v=row.value as unknown as RdlProject;return [sql('INSERT INTO bf_rdl_imports(id,owner_id,value_json,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision',row.targetId,v.ownerId,canonicalJson(row.value),row.revision)]},
 remove(destination,kind,id){return valid(destination,kind,id)?[sql('DELETE FROM bf_rdl_imports WHERE id=?',id)]:[sql('SELECT 0')]},
 async list(db,destination){const id=destination.slice('bifocal:rdl:'.length);if(!valid(destination,'rdl-project',id))return [];return (await db.prepare('SELECT * FROM bf_rdl_imports WHERE id=?').bind(id).all<RdlRow>()).results.map(native)},
}
