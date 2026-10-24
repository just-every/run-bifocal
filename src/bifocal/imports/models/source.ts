import { compileProject } from './compile'
import type { Source } from '../../query/types'
import type { ImportDoorSource } from '../../../modules/import-kit/src/door/types.ts'
import type { Json, TargetRow } from '../../../modules/import-kit/src/types.ts'
export function modelProjectSource(id:string,ownerId:string,sources:Source[],current:TargetRow|undefined):ImportDoorSource {
 return {parse(value){try{const project=compileProject(value,id,ownerId,sources);return {kind:'model-project',sourceId:id,payload:project as unknown as Json}}catch{return {kind:'model-project-invalid',sourceId:id,payload:{reason:'MODEL_PROJECT_SCHEMA: Review the project envelope, source files, bindings and exact formats.'}}}},mapping:{version:'model-project-v1',map(record){if(record.kind!=='model-project')return {effects:[],rejection:'MODEL_PROJECT_SCHEMA: A bounded model project with explicit source bindings is required.'};return {effects:[{targetKind:'model-project',targetId:id,value:record.payload,...(current?{expectedRevision:current.revision}:{})}]}}}}
}
