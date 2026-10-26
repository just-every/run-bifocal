import { compileAppImport, type Person } from './compile'
import type { ImportDoorSource } from '../../../modules/import-kit/src/door/types.ts'
import type { Json, TargetRow } from '../../../modules/import-kit/src/types.ts'
export function appImportSource(id:string,ownerId:string,people:Person[],current:TargetRow|undefined):ImportDoorSource {
 return {parse(value){try{return {kind:'power-bi-app',sourceId:id,payload:compileAppImport(value,id,ownerId,people) as unknown as Json}}catch{return {kind:'power-bi-app-invalid',sourceId:id,payload:{reason:'POWER_BI_APP_SCHEMA: Review the app envelope, content, audiences, members and row roles.'}}}},mapping:{version:'power-bi-app-v1',map(record){if(record.kind!=='power-bi-app')return {effects:[],rejection:'POWER_BI_APP_SCHEMA: A bounded Power BI app export with audiences is required.'};return {effects:[{targetKind:'power-bi-app',targetId:id,value:record.payload,...(current?{expectedRevision:current.revision}:{})}]}}}}
}
