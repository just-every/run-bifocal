import { compileLibrary } from './compile'
import type { CalculationScope } from './governance.server'
import type { ImportDoorSource } from '../../../modules/import-kit/src/door/types.ts'
import type { Json, TargetRow } from '../../../modules/import-kit/src/types.ts'
export function calculationLibrarySource(id:string,ownerId:string,scope:CalculationScope,current:TargetRow|undefined):ImportDoorSource {
 return {parse(value){try{const project=compileLibrary(value,id,ownerId,scope);return {kind:'calculation-library',sourceId:id,payload:project as unknown as Json}}catch{return {kind:'calculation-library-invalid',sourceId:id,payload:{reason:'CALCULATION_LIBRARY_SCHEMA: Review the project envelope, source files, bindings and exact formats.'}}}},mapping:{version:'calculation-library-v1',map(record){if(record.kind!=='calculation-library')return {effects:[],rejection:'CALCULATION_LIBRARY_SCHEMA: A bounded calculation library with explicit source bindings is required.'};return {effects:[{targetKind:'calculation-library',targetId:id,value:record.payload,...(current?{expectedRevision:current.revision}:{})}]}}}}
}
