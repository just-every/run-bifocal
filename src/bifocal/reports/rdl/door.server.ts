import { runtimeBindings, type Bindings } from '../../../auth.server'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { createImportOperatorHandler, readImportDoorHistory } from '../../../modules/import-kit/src/door/operator.ts'
import { loadSnapshot, transact, sql, assertion } from '../../../modules/import-kit/src/door/store.ts'
import type { DoorPlanRow, DoorRequest, ImportDoorSource } from '../../../modules/import-kit/src/door/types.ts'
import { DoorError } from '../../../modules/import-kit/src/door/protocol.ts'
import { readD1ImportOriginals, retireD1ImportCustody } from '../../../modules/import-kit/src/d1/index.ts'
import type { D1ImportContext } from '../../../modules/import-kit/src/d1/types.ts'
import type { Json } from '../../../modules/import-kit/src/types.ts'
import { ownerIdentity } from '../../data/snapshots/store'
import { fileOwner } from '../../imports/files/owner.server'
import { rejectedUpload } from '../../http/rejected'
import { exactKeys, json, jsonBody } from '../../models/validation/transport'
import { fail, QueryError } from '../../query/types'
import { compileRdl } from './parse'
import { rdlPreviewResponse } from './preview.server'
import { retainRdl, readRdl, type StoredRdlProject } from './custody'
import { rdlDestination, rdlImportTargets, type RdlRow } from './targets'

async function handle(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,resource=/^\/api\/operator\/rdl-imports\/([a-z][a-z0-9-]{0,63})(?:\/(erase|accept|preview|download))?$/.exec(path)
 if(!resource&&!(path.startsWith('/api/operator/import/')&&request.headers.get('X-Import-Kind')==='rdl'))return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),id=resource?.[1]??request.headers.get('X-Import-Dataset')??''
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(id)||url.search)fail('rdl_project_id_required',400)
 const destination=rdlDestination(id),namespace='rdl:'+id,context:D1ImportContext={destination,namespace,mappingVersion:'rdl-project-v1',storage:{database:env.DB,targets:rdlImportTargets},authorization:{principalId:'role:owner',predicate:()=>owner}}
 if(resource){
  const row=await env.DB.prepare('SELECT * FROM bf_rdl_imports WHERE id=? AND owner_id=?').bind(id,ownerId).first<RdlRow>(),project=row?readRdl(JSON.parse(row.value_json)):null
  if(resource[2]==='erase'){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['confirmReport','reviewedRevision'])
   if(input.confirmReport!==id||input.reviewedRevision!==(row?.revision??null))fail('exact_rdl_erasure_confirmation_required',409)
   const guard=row?rdlImportTargets.matches({destination,targetKind:'rdl-project',targetId:id,revision:row.revision,value:JSON.parse(row!.value_json) as Json},destination,'rdl-project',id):sql('NOT EXISTS(SELECT 1 FROM bf_rdl_imports WHERE id=?)',id)
   const state=await env.DB.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first<{source_identity:string}>(),identity=state?.source_identity??crypto.randomUUID()
   const checkpoint=[sql('INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)',identity),assertion(sql('EXISTS(SELECT 1 FROM rer_portability_state WHERE id=1 AND source_identity=?)',identity)),sql('INSERT OR IGNORE INTO rer_portability_journal(source,tombstone) VALUES(?,?)',identity,sha256(canonicalJson([identity,'rer_portability_state',{id:1}]))),sql('UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1'),sql('INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)')]
   return json(await retireD1ImportCustody({target:{kind:'rdl-project',id}},[assertion(guard),sql('DELETE FROM bf_rdl_imports WHERE id=?',id)],context,checkpoint))
  }
  if(!row||!project)fail('rdl_project_not_found',404)
  await transact(env.DB,owner,[assertion(sql('EXISTS(SELECT 1 FROM bf_rdl_imports WHERE id=? AND owner_id=? AND revision=?)',id,ownerId,row.revision))])
  if(resource[2]==='preview'||resource[2]==='download')return rdlPreviewResponse(request,env,owner,ownerId,project,row.revision,sql('EXISTS(SELECT 1 FROM bf_rdl_imports WHERE id=? AND owner_id=? AND revision=? AND value_json=?)',id,ownerId,row.revision,row.value_json),resource[2])
  if(resource[2]==='accept'){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['reviewedRevision'])
   if(input.reviewedRevision!==row.revision)fail('current_rdl_revision_required',409)
   return json({error:'rdl_switch_not_proven',issues:project.report.issues,required:'Reconcile authorized source output through the complete native report job and reauthorize subscriptions before acceptance.'},422)
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  return json({id,revision:row.revision,...project})
 }
 if(['uploads','plan','apply','undo'].some(action=>path==='/api/operator/import/'+action)&&await env.DB.prepare('SELECT 1 FROM ik_d1_erased_targets WHERE destination=? AND identity=?').bind(destination,sha256(canonicalJson([destination,'rdl-project',id]))).first())fail('rdl_project_erased',410)
 const current=await rdlImportTargets.read(env.DB,destination,'rdl-project',id)
 if(path==='/api/operator/import/plan'&&request.headers.has('X-Rdl-Base-Revision')&&current?.revision!==request.headers.get('X-Rdl-Base-Revision'))fail('current_rdl_revision_required',409)
 const source:ImportDoorSource={parse(value){try{return {kind:'rdl-project',sourceId:id,payload:retainRdl(compileRdl(value,id,ownerId)) as unknown as Json}}catch(error){return {kind:'rdl-invalid',sourceId:id,payload:{reason:error instanceof Error?error.message:'RDL_SCHEMA'}}}},mapping:{version:'rdl-project-v1',map(record){if(record.kind!=='rdl-project')return {effects:[],rejection:String((record.payload as {reason:string}).reason)};return {effects:[{targetKind:'rdl-project',targetId:id,value:record.payload,...current?{expectedRevision:current.revision}:{}}]}}}}
 const options={...source,database:env.DB,targets:rdlImportTargets,destination,format:'json' as const,ownerPrincipalId:'role:owner',installationId:'bifocal:files:v1',appOrigin:env.AUTH_ORIGIN,ownerEmail:owner.email,namespace,limits:{maxBytes:1048576,maxRecords:1,maxRecordBytes:1048576},authorize:(r:Request)=>fileOwner(r,env)}
 const rowForPlan=(planId:string)=>env.DB.prepare('SELECT * FROM ik_door_plans WHERE id=? AND installation_id=? AND namespace=? AND complete=1').bind(planId,options.installationId,namespace).first<DoorPlanRow>()
 const admitted:DoorRequest={options,authority:owner,via:'operator',epoch:0,access:{action:'plan',installationId:options.installationId,email:owner.email,namespace,maxBytes:1048576,maxRecords:1,maxChunks:16}}
 if(path==='/api/operator/import/history'){
  if(request.method!=='GET')fail('method_not_allowed',405)
  const lineage=await env.DB.prepare('SELECT head_id FROM ik_door_namespaces WHERE installation_id=? AND namespace=?').bind(options.installationId,namespace).first<{head_id:string|null}>()
  return json({history:(await readImportDoorHistory(env.DB,options.installationId,owner)).filter(r=>r.namespace===namespace),headPlanId:lineage?.head_id??null})
 }
 if(path.startsWith('/api/operator/import/original/')){
  if(request.method!=='GET')fail('method_not_allowed',405)
  const row=await rowForPlan(path.slice('/api/operator/import/original/'.length));if(!row?.job_id)fail('original_not_found',404)
  const job=await env.DB.prepare('SELECT namespace,mapping_version FROM ik_jobs WHERE id=?').bind(row.job_id).first<{namespace:string;mapping_version:string}>();if(!job)fail('original_not_found',404)
  return json({originals:await readD1ImportOriginals(row.job_id,{...context,namespace:job.namespace,mappingVersion:job.mapping_version})})
 }
 if(path==='/api/operator/import/apply'&&request.method==='POST'){
  const input=await jsonBody(request.clone()),row=typeof input.planId==='string'?await rowForPlan(input.planId):null
  if(row&&(await loadSnapshot(admitted,row)).plan.counts.rejected)fail('rdl_mapping_rejected',422)
 }
 const response=await createImportOperatorHandler(options)(request)
 if(path==='/api/operator/import/plan'&&response?.ok){
  const preview=await response.json() as {planId:string},row=await rowForPlan(preview.planId);if(!row)fail('plan_not_found',404)
  const snapshot=await loadSnapshot(admitted,row)
  const entry=snapshot.plan.entries[0],project=entry&&!entry.rejection&&entry.source.kind==='rdl-project'?readRdl(entry.source.payload as unknown as StoredRdlProject):null
  return json({...preview,project})
 }
 return response
}
export async function rdlImportResponse(request:Request,env:Bindings):Promise<Response|null>{
 let response
 try{response=await handle(request,env)}catch(error){response=error instanceof QueryError||error instanceof DoorError?json({error:error.code},error.status):json({error:'rdl_import_conflict',reason:'Reload the report draft and review its exact plan again.'},409)}
 return response?rejectedUpload(request,response):null
}
