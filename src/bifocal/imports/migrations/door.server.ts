import { digest, text } from './compile'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { runtimeBindings, type Bindings } from '../../../auth.server'
import { rejectedUpload } from '../../http/rejected'
import { fileOwner } from '../files/owner.server'
import { ownerIdentity } from '../../data/snapshots/store'
import { fail, QueryError } from '../../query/types'
import { createImportOperatorHandler, readImportDoorHistory } from '../../../modules/import-kit/src/door/operator.ts'
import { loadSnapshot, transact, assertion, sql } from '../../../modules/import-kit/src/door/store.ts'
import type { DoorPlanRow, DoorRequest } from '../../../modules/import-kit/src/door/types.ts'
import { DoorError } from '../../../modules/import-kit/src/door/protocol.ts'
import { readD1ImportOriginals } from '../../../modules/import-kit/src/d1/index.ts'
import { exactKeys, json, jsonBody } from '../../models/validation/transport'
import { migrationImportDestination, migrationImportTargets } from './targets'
import { migrationImportSource } from './source'
import { migrationImportContext, eraseMigrationProject, importGuard, readMigrationProject } from './store.server'

/** The Migration inventory enters through Base's shared door: review, exact fingerprint, reconcile, Undo and erase. */
async function handleMigrationProject(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,resource=/^\/api\/operator\/migration-projects\/([a-z][a-z0-9-]{0,63})(\/(erase|edit|resolve|versions\/([a-f0-9]{64})))?$/.exec(path)
 if(!resource&&!(path.startsWith('/api/operator/import/')&&request.headers.get('X-Import-Kind')==='migration-project'))return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),id=resource?.[1]??request.headers.get('X-Import-Dataset')??''
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(id)||url.search)fail('migration_project_id_required',400)
 if(resource){
  let current
  try{current=await readMigrationProject(env,ownerId,id)}catch(error){if(!(error instanceof QueryError)||error.code!=='migration_project_not_found'||resource[3]!=='erase')throw error}
  if(resource[3]==='edit'||resource[3]==='resolve'){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,resource[3]==='edit'?['reviewedRevision','itemId','native']:['reviewedRevision','itemId','choice'])
   if(input.reviewedRevision!==current!.revision)fail('migration_review_stale',409)
   const value=structuredClone(current!.value),entry=value.items.find(i=>i.source.id===input.itemId)
   if(!entry)fail('migration_item_not_found',404)
   if(resource[3]==='edit'){entry.native=text(input.native);entry.edited=true}
   else {
    if(!entry.conflict)fail('migration_conflict_required',409)
    if(input.choice!=='keep-native'&&input.choice!=='use-source')fail('migration_resolution_required',400)
    entry.source=entry.conflict;entry.conflict=null
    if(input.choice==='use-source'){entry.native=entry.source.original;entry.edited=false}
   }
   const revision=digest({previous:current!.revision,action:resource[3],value}),body=canonicalJson(value)
   await transact(env.DB,owner,[assertion(importGuard(current!)),sql('UPDATE bf_migration_workspaces SET revision=?,value_json=? WHERE id=?',revision,body,id),sql('INSERT INTO bf_migration_project_edits(project_id,revision,action,value_json) VALUES(?,?,?,?)',id,revision,resource[3],body)])
   return json({revision,...value})
  }
  if(resource[3]==='erase'){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['confirmImport','reviewedRevision'])
   if(input.confirmImport!==id||input.reviewedRevision!==(current?.revision??null))fail('exact_import_erasure_confirmation_required',409)
   return json(await eraseMigrationProject(env,owner,id,current?[importGuard(current)]:[]))
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  await transact(env.DB,owner,[assertion(importGuard(current!))])
  if(resource[4]){
   const version=await env.DB.prepare('SELECT revision,action,value_json FROM bf_migration_project_edits WHERE project_id=? AND revision=?').bind(id,resource[4]).first<{revision:string;action:string;value_json:string}>()
   if(!version)fail('migration_version_not_found',404)
   return json({revision:version.revision,action:version.action,value:JSON.parse(version.value_json)})
  }
  const edits=(await env.DB.prepare('SELECT revision,action FROM bf_migration_project_edits WHERE project_id=? ORDER BY rowid DESC LIMIT 101').bind(id).all<{revision:string;action:string}>()).results
  return json({revision:current!.revision,...current!.value,history:edits.slice(0,100),historyTruncated:edits.length>100})
 }
 const destination=migrationImportDestination(id)
 if(['uploads','plan','apply','undo'].some(action=>path==='/api/operator/import/'+action)&&await env.DB.prepare('SELECT 1 FROM ik_d1_erased_targets WHERE destination=? AND identity=?').bind(destination,sha256(canonicalJson([destination,'migration-project',id]))).first())fail('migration_project_erased',410)
 const namespace='migration-projects:'+id,current=await migrationImportTargets.read(env.DB,destination,'migration-project',id)
 const workspace=current?await readMigrationProject(env,ownerId,id):undefined
 if(path==='/api/operator/import/undo'&&workspace&&(workspace.revision!==current?.revision||workspace.value.expectedWorkspace!==null))fail('migration_undo_requires_native_review',409)
 const source=migrationImportSource(id,ownerId,current,workspace)
 const options={...source,database:env.DB,targets:migrationImportTargets,destination,format:'json' as const,ownerPrincipalId:'role:owner',installationId:'bifocal:files:v1',appOrigin:env.AUTH_ORIGIN,ownerEmail:owner.email,namespace,limits:{maxBytes:1048576,maxRecords:1,maxRecordBytes:1048576},authorize:(r:Request)=>fileOwner(r,env)}
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
  return json({originals:await readD1ImportOriginals(row.job_id,{...migrationImportContext(env,owner,id),namespace:job.namespace,mappingVersion:job.mapping_version})})
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
export async function migrationImportResponse(request:Request,env:Bindings):Promise<Response|null>{
 let response
 try{response=await handleMigrationProject(request,env)}catch(error){response=error instanceof QueryError||error instanceof DoorError?json({error:error.code},error.status):json({error:'migration_project_conflict',reason:'Reload the current project, then review again.'},409)}
 return response?rejectedUpload(request,response):null
}
