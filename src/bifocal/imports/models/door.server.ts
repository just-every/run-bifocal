import { compileProject } from './compile'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { runtimeBindings, type Bindings } from '../../../auth.server'
import { rejectedUpload } from '../../http/rejected'
import { fileOwner } from '../files/owner.server'
import { ownerIdentity } from '../../data/snapshots/store'
import type { Source } from '../../query/types'
import { fail, QueryError } from '../../query/types'
import { createImportOperatorHandler, readImportDoorHistory } from '../../../modules/import-kit/src/door/operator.ts'
import { loadSnapshot, transact, sql, assertion } from '../../../modules/import-kit/src/door/store.ts'
import type { DoorPlanRow, DoorRequest } from '../../../modules/import-kit/src/door/types.ts'
import { DoorError } from '../../../modules/import-kit/src/door/protocol.ts'
import { readD1ImportOriginals } from '../../../modules/import-kit/src/d1/index.ts'
import { exactKeys, json, jsonBody } from '../../models/validation/transport'
import { modelDestination, modelImportTargets } from './targets'
import { modelProjectSource } from './source'
import { eraseImportedProject, modelImportContext, projectGuard, readImportedProject } from './store.server'

async function handleModelImport(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,resource=/^\/api\/operator\/model-imports\/([a-z][a-z0-9-]{0,63})(\/erase|\/export|\/preparation)?$/.exec(path)
 if(!resource&&!(path.startsWith('/api/operator/import/')&&request.headers.get('X-Import-Kind')==='model'))return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),id=resource?.[1]??request.headers.get('X-Import-Dataset')??''
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(id)||url.search)fail('model_project_id_required',400)
 if(resource){
  let current
  try{current=await readImportedProject(env,ownerId,id)}catch(error){if(!(error instanceof QueryError)||error.code!=='model_project_not_found'||resource[2]!=='/erase')throw error}
  if(resource[2]==='/preparation'){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['reviewedRevision','flow'])
   if(input.reviewedRevision!==current!.revision)fail('exact_project_preparation_revision_required',409)
   const rows=(await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables ORDER BY id LIMIT 101').all<Omit<Source,'table'>>()).results
   if(rows.length>100)fail('model_source_catalog_limit',413)
   const sources=rows.map(row=>({...row,table:JSON.parse(row.value_json)}))
   for(const pin of current!.value.sources)if(!sources.some(s=>s.id===pin.id&&s.revision===pin.revision))fail('preparation_import_source_changed',409)
   // Reparse retained originals: uploaded or stored report fields never confer
   // execution authority. Every item in the project must be resolved first.
   const project=compileProject(current!.value.input,id,ownerId,sources),flow=project.preparation?.find(f=>f.id===input.flow)
   if(!project.report.compatible||!flow?.compatible||!flow.document)fail('unresolved_preparation_import',409)
   await transact(env.DB,owner,[assertion(projectGuard(current!)),...project.sources.map(s=>assertion(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=?)',s.id,s.revision)))])
   return json({document:{...flow.document,imported:{project:id,revision:current!.revision,flow:flow.id}},sql:flow.sql,output:flow.output,published:false})
  }
  if(resource[2]==='/export'){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['reviewedRevision'])
   if(input.reviewedRevision!==current!.revision)fail('exact_project_export_revision_required',409)
   const project=current!.value
   if(!project.report.compatible||!project.definition)fail('unresolved_project_export',409)
   // Export only native executable fields and explicit lineage. Original file
   // bytes, connection definitions and installation authority never travel.
   const artifact={version:1,project:{id,revision:current!.revision,format:project.input.format,digest:project.digest},definition:project.definition,
    sources:project.report.project.tables.map(table=>({table:table.name,file:table.file,dataset:project.input.bindings[table.name]?.dataset,revision:project.sources.find(s=>s.id===project.input.bindings[table.name]?.dataset)?.revision,grain:project.input.bindings[table.name]?.grain??[],
     columns:table.dimensions.map(d=>({source:d.name,column:project.input.bindings[table.name]?.columns?.[d.column]??d.column}))})),
    measures:project.report.translations.map(t=>({sourceObject:t.sourceObject,view:t.view,measure:t.measure.id}))}
   await transact(env.DB,owner,[assertion(projectGuard(current!)),...project.sources.map(s=>assertion(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=?)',s.id,s.revision)))])
   const response=json(artifact);response.headers.set('content-disposition','attachment; filename="'+id+'.native.json"');return response
  }
  if(resource[2]==='/erase'){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['confirmProject','reviewedRevision'])
   if(input.confirmProject!==id||input.reviewedRevision!==(current?.revision??null))fail('exact_project_erasure_confirmation_required',409)
   return json(await eraseImportedProject(env,owner,id,current?[projectGuard(current)]:[]))
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  await transact(env.DB,owner,[assertion(projectGuard(current!))])
  return json({id,revision:current!.revision,...current!.value})
 }
 const destination=modelDestination(id)
 if(['uploads','plan','apply','undo'].some(action=>path==='/api/operator/import/'+action)&&await env.DB.prepare('SELECT 1 FROM ik_d1_erased_targets WHERE destination=? AND identity=?').bind(destination,sha256(canonicalJson([destination,'model-project',id]))).first())fail('model_project_erased',410)
 const namespace='models:'+id,current=await modelImportTargets.read(env.DB,destination,'model-project',id)
 const rows=(await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables ORDER BY id LIMIT 101').all<Omit<Source,'table'>>()).results
 if(rows.length>100)fail('model_source_catalog_limit',413)
 const sources=rows.map(row=>({...row,table:JSON.parse(row.value_json)})),source=modelProjectSource(id,ownerId,sources,current)
 const options={...source,database:env.DB,targets:modelImportTargets,destination,format:'json' as const,ownerPrincipalId:'role:owner',installationId:'bifocal:files:v1',appOrigin:env.AUTH_ORIGIN,ownerEmail:owner.email,namespace,limits:{maxBytes:1048576,maxRecords:1,maxRecordBytes:1048576},authorize:(r:Request)=>fileOwner(r,env)}
 const rowForPlan=(planId:string)=>env.DB.prepare('SELECT * FROM ik_door_plans WHERE id=? AND installation_id=? AND namespace=? AND complete=1').bind(planId,options.installationId,namespace).first<DoorPlanRow>()
 const admitted:DoorRequest={options,authority:owner,via:'operator',epoch:0,access:{action:'plan',installationId:options.installationId,email:owner.email,namespace,maxBytes:1048576,maxRecords:1,maxChunks:16}}
 if(path==='/api/operator/import/history'){
  if(request.method!=='GET')fail('method_not_allowed',405)
  return json({history:(await readImportDoorHistory(env.DB,options.installationId,owner)).filter(r=>r.namespace===namespace)})
 }
 if(path.startsWith('/api/operator/import/original/')){
  if(request.method!=='GET')fail('method_not_allowed',405)
  const row=await rowForPlan(path.slice('/api/operator/import/original/'.length));if(!row?.job_id)fail('original_not_found',404)
  const job=await env.DB.prepare('SELECT namespace,mapping_version FROM ik_jobs WHERE id=?').bind(row.job_id).first<{namespace:string;mapping_version:string}>();if(!job)fail('original_not_found',404)
  return json({originals:await readD1ImportOriginals(row.job_id,{...modelImportContext(env,owner,id),namespace:job.namespace,mappingVersion:job.mapping_version})})
 }
 if(path==='/api/operator/import/apply'&&request.method==='POST'){
  const input=await jsonBody(request.clone()),row=typeof input.planId==='string'?await rowForPlan(input.planId):null
  if(row){const snapshot=await loadSnapshot(admitted,row);if(snapshot.plan.counts.rejected)fail('mapping_rejected',422)}
 }
 const response=await createImportOperatorHandler(options)(request)
 if(path==='/api/operator/import/plan'&&response?.ok){
  const preview=await response.json() as {planId:string},row=await rowForPlan(preview.planId);if(!row)fail('plan_not_found',404)
  const snapshot=await loadSnapshot(admitted,row),project=snapshot.plan.entries[0]?.effects[0]?.value
  const dependencies=(project as unknown as import('./compile').CompiledProject|undefined)?.sources??[]
  await transact(env.DB,owner,dependencies.map(s=>sql('INSERT OR IGNORE INTO bf_model_import_sources(project_id,dataset_id) VALUES(?,?)',id,s.id)))
  return json({...preview,project})
 }
 return response
}
export async function modelImportResponse(request:Request,env:Bindings):Promise<Response|null>{
 let response
 try{response=await handleModelImport(request,env)}catch(error){response=error instanceof QueryError||error instanceof DoorError?json({error:error.code},error.status):json({error:'model_import_conflict',reason:'Reload the current project and source records, then review again.'},409)}
 return response?rejectedUpload(request,response):null
}
