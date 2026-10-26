import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { fileTargets, fileDestination } from '../imports/files/targets'
import { guarded, sql } from '../company/store'
import { body, ConventionsError, identifier, object, requireValue } from '../company/protocol'
import { rejectedResponse } from '../../base/rejected-response'
export const retentionAllowsErasure=(dataset:string)=>sql("NOT EXISTS(SELECT 1 FROM bf_source_retention WHERE dataset_id=? AND (legal_hold=1 OR minimum_retain_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')))",dataset)
export async function retentionPolicyResponse(request:Request,original:Bindings):Promise<Response|null>{
 const path=new URL(request.url).pathname
 if(!path.startsWith('/api/operator/retention/'))return null
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}})
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return rejectedResponse(request,json({error:'owner_required'},401))
 try{
  const dataset=identifier(path.slice('/api/operator/retention/'.length))
  if(request.method==='GET'){
   const [rows,sources]=await guarded<{revision:string}>(env,owner,[sql('SELECT revision,legal_hold,minimum_retain_until FROM bf_source_retention WHERE dataset_id=?',dataset),sql('SELECT revision FROM bf_file_tables WHERE id=?',dataset)])
   return json({dataset,reviewedDatasetRevision:sources[0]?.revision??null,policy:rows[0]??null,semantics:'Minimum retention and legal holds prevent explicit source erasure. No rule automatically expires or purges any content. Existing content remains until an explicit reviewed owner erasure after all holds are released.'})
  }
  if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
  const input=object(await body(request),['confirmDataset','reviewedDatasetRevision','previousRevision','legalHold','minimumRetainUntil','releaseHold'])
  requireValue(input.confirmDataset===dataset&&typeof input.legalHold==='boolean','exact_retention_confirmation_required')
  requireValue(input.previousRevision===null||typeof input.previousRevision==='string','previous_revision_required')
  const until=input.minimumRetainUntil
  requireValue(until===null||(typeof until==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(until)&&!Number.isNaN(Date.parse(until))&&new Date(until).toISOString()===until),'invalid_retention_time')
  const current=await fileTargets.read(env.DB,fileDestination(dataset),'file-table',dataset)
  requireValue(input.reviewedDatasetRevision===(current?.revision??null),'dataset_review_required')
  const match=fileTargets.matches(current??null,fileDestination(dataset),'file-table',dataset),revision=randomUUID(),auditId=randomUUID()
  // Removing either protection always requires a separate explicit release.
  await guarded(env,owner,[sql(`INSERT INTO bf_conventions_assertions(ok) SELECT CASE WHEN (${match.sql}) AND (SELECT revision FROM bf_source_retention WHERE dataset_id=?) IS ? AND (?=1 OR NOT EXISTS(SELECT 1 FROM bf_source_retention WHERE dataset_id=? AND (legal_hold=1 OR minimum_retain_until IS NOT NULL))) THEN 1 ELSE 0 END`,...match.params??[],dataset,input.previousRevision,input.releaseHold===true?1:0,dataset),
   sql('INSERT INTO bf_source_retention VALUES(?,?,?,?) ON CONFLICT(dataset_id) DO UPDATE SET revision=excluded.revision,legal_hold=excluded.legal_hold,minimum_retain_until=excluded.minimum_retain_until',dataset,revision,input.legalHold?1:0,until),
   sql("INSERT INTO bf_erasure_audit(id,actor_ref,subject_ref,recorded_at,kind) VALUES(?,?,?,?,'retention_changed')",auditId,randomUUID(),randomUUID(),new Date().toISOString())])
  return json({revision,auditId,legalHold:input.legalHold,minimumRetainUntil:until,automaticErasure:false})
 }catch(error){
  if(error instanceof ConventionsError)return json({error:error.code},error.status)
  return json({error:'retention_conflict',recovery:'Review the current source and policy. Explicitly acknowledge releaseHold when replacing existing retention protection.'},409)
 }
}
