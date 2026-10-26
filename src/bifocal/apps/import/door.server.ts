import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { runtimeBindings, type Bindings } from '../../../auth.server'
import { rejectedUpload } from '../../http/rejected'
import { fileOwner } from '../../imports/files/owner.server'
import { ownerIdentity } from '../../data/snapshots/store'
import { fail, QueryError } from '../../query/types'
import { createImportOperatorHandler, readImportDoorHistory } from '../../../modules/import-kit/src/door/operator.ts'
import { loadSnapshot, transact, assertion } from '../../../modules/import-kit/src/door/store.ts'
import type { DoorPlanRow, DoorRequest } from '../../../modules/import-kit/src/door/types.ts'
import { DoorError } from '../../../modules/import-kit/src/door/protocol.ts'
import { readD1ImportOriginals } from '../../../modules/import-kit/src/d1/index.ts'
import { exactKeys, json, jsonBody } from '../../models/validation/transport'
import { appImportDestination, appImportTargets } from './targets'
import { appImportSource } from './source'
import { appImportContext, eraseAppImport, importGuard, readAppImport } from './store.server'

/** The Power BI app export enters through Base's shared door: review, exact fingerprint, reconcile, Undo and erase. */
async function handleAppImport(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,resource=/^\/api\/operator\/app-imports\/([a-z][a-z0-9-]{0,63})(\/erase)?$/.exec(path)
 if(!resource&&!(path.startsWith('/api/operator/import/')&&request.headers.get('X-Import-Kind')==='power-bi-app'))return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),id=resource?.[1]??request.headers.get('X-Import-Dataset')??''
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(id)||url.search)fail('app_import_id_required',400)
 if(resource){
  let current
  try{current=await readAppImport(env,ownerId,id)}catch(error){if(!(error instanceof QueryError)||error.code!=='app_import_not_found'||!resource[2])throw error}
  if(resource[2]){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['confirmImport','reviewedRevision'])
   if(input.confirmImport!==id||input.reviewedRevision!==(current?.revision??null))fail('exact_import_erasure_confirmation_required',409)
   return json(await eraseAppImport(env,owner,id,current?[importGuard(current)]:[]))
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  await transact(env.DB,owner,[assertion(importGuard(current!))])
  return json({revision:current!.revision,...current!.value})
 }
 const destination=appImportDestination(id)
 if(['uploads','plan','apply','undo'].some(action=>path==='/api/operator/import/'+action)&&await env.DB.prepare('SELECT 1 FROM ik_d1_erased_targets WHERE destination=? AND identity=?').bind(destination,sha256(canonicalJson([destination,'power-bi-app',id]))).first())fail('app_import_erased',410)
 const namespace='app-imports:'+id,current=await appImportTargets.read(env.DB,destination,'power-bi-app',id)
 const people=(await env.DB.prepare("SELECT id,email,version FROM oa_operators WHERE status='active' AND role<>'owner' ORDER BY email LIMIT 201").all<{id:string;email:string;version:number}>()).results
 if(people.length>200)fail('app_import_member_limit',413)
 const source=appImportSource(id,ownerId,people,current)
 const options={...source,database:env.DB,targets:appImportTargets,destination,format:'json' as const,ownerPrincipalId:'role:owner',installationId:'bifocal:files:v1',appOrigin:env.AUTH_ORIGIN,ownerEmail:owner.email,namespace,limits:{maxBytes:1048576,maxRecords:1,maxRecordBytes:1048576},authorize:(r:Request)=>fileOwner(r,env)}
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
  return json({originals:await readD1ImportOriginals(row.job_id,{...appImportContext(env,owner,id),namespace:job.namespace,mappingVersion:job.mapping_version})})
 }
 if(path==='/api/operator/import/apply'&&request.method==='POST'){
  const input=await jsonBody(request.clone()),row=typeof input.planId==='string'?await rowForPlan(input.planId):null
  if(row){const snapshot=await loadSnapshot(admitted,row);if(snapshot.plan.counts.rejected)fail('mapping_rejected',422)}
 }
 const response=await createImportOperatorHandler(options)(request)
 if(path==='/api/operator/import/plan'&&response?.ok){
  const preview=await response.json() as {planId:string},row=await rowForPlan(preview.planId);if(!row)fail('plan_not_found',404)
  const snapshot=await loadSnapshot(admitted,row)
  return json({...preview,project:snapshot.plan.entries[0]?.effects[0]?.value})
 }
 return response
}
export async function appImportResponse(request:Request,env:Bindings):Promise<Response|null>{
 let response
 try{response=await handleAppImport(request,env)}catch(error){response=error instanceof QueryError||error instanceof DoorError?json({error:error.code},error.status):json({error:'app_import_conflict',reason:'Reload the current import and members, then review again.'},409)}
 return response?rejectedUpload(request,response):null
}
