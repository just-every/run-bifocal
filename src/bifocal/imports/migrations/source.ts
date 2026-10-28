import { compileMigration, type MigrationProject, digest } from './compile'
import type { ImportDoorSource } from '../../../modules/import-kit/src/door/types.ts'
import type { Json, TargetRow } from '../../../modules/import-kit/src/types.ts'
export function migrationImportSource(id:string,ownerId:string,current:TargetRow|undefined,workspace?:{revision:string;value:MigrationProject}):ImportDoorSource {
 return {parse(value){try{
 const previous=current?.value as unknown as MigrationProject|undefined
 const baseline=compileMigration(value,id,ownerId,previous)
 const equivalent=previous&&digest({...baseline,expectedWorkspace:null})===digest({...previous,expectedWorkspace:null})
 const project=equivalent?previous:compileMigration(value,id,ownerId,workspace?.value??previous,workspace?.revision??null)
 return {kind:'migration-project',sourceId:id,payload:project as unknown as Json}}catch{return {kind:'migration-project-invalid',sourceId:id,payload:{reason:'MIGRATION_PROJECT_SCHEMA: Review source inventory, stable revisions, mapping, cutoff and rollback plan.'}}}},mapping:{version:'migration-project-v1',map(record){if(record.kind!=='migration-project')return {effects:[],rejection:'MIGRATION_PROJECT_SCHEMA: A bounded inert migration inventory is required.'};return {effects:[{targetKind:'migration-project',targetId:id,value:record.payload,...(current?{expectedRevision:current.revision}:{})}]}}}}
}
