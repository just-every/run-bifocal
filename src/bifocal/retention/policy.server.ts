import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { fileTargets, fileDestination } from '../imports/files/targets'
import { guarded, sql } from '../company/store'
import { body, ConventionsError, identifier, object, requireValue } from '../company/protocol'
import { rejectedResponse } from '../../base/rejected-response'
import { protectionHistory } from './history.server'
export const retentionAllowsErasure=(dataset:string)=>sql("NOT EXISTS(SELECT 1 FROM bf_source_retention WHERE dataset_id=? AND (legal_hold=1 OR minimum_retain_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')))",dataset)
export async function retentionPolicyResponse(request:Request,original:Bindings):Promise<Response|null>{
 const path=new URL(request.url).pathname
 if(!path.startsWith('/api/operator/retention/'))return null
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}})
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner||request.headers.has('authorization'))return rejectedResponse(request,json({error:'owner_required'},401))
 try{
  const parts=path.slice('/api/operator/retention/'.length).split('/'),dataset=identifier(parts[0])
  if(parts.length>1){
   if(parts.length!==2||parts[1]!=='history')return json({error:'not_found'},404)
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   return json(await protectionHistory(env,owner,dataset))
  }
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
  const match=fileTargets.matches(current??null,fileDestination(dataset),'file-table',dataset),revision=randomUUID(),auditId=randomUUID(),recordedAt=new Date().toISOString()
  // Removing either protection always requires a separate explicit release.
  await guarded(env,owner,[sql(`INSERT INTO bf_conventions_assertions(ok) SELECT CASE WHEN (${match.sql}) AND NOT EXISTS(SELECT 1 FROM ik_d1_erasure_journal WHERE destination=?) AND NOT EXISTS(SELECT 1 FROM bf_preparation_erasing WHERE dataset_id=?) AND (SELECT revision FROM bf_source_retention WHERE dataset_id=?) IS ? AND (?=1 OR NOT EXISTS(SELECT 1 FROM bf_source_retention WHERE dataset_id=? AND (legal_hold=1 OR minimum_retain_until IS NOT NULL))) THEN 1 ELSE 0 END`,...match.params??[],fileDestination(dataset),dataset,dataset,input.previousRevision,input.releaseHold===true?1:0,dataset),
   sql("INSERT INTO bf_erasure_audit(id,actor_ref,subject_ref,recorded_at,kind) VALUES(?,?,?,?,'retention_changed')",auditId,randomUUID(),randomUUID(),recordedAt),
   sql(`INSERT INTO bf_retention_acknowledgments(audit_id,dataset_id,source_revision,source_state,approving_owner_id,approving_owner_version,previous_revision,replacement_revision,before_legal_hold,before_minimum_retain_until,after_legal_hold,after_minimum_retain_until,release_acknowledged)
    SELECT ?,?,?,?,o.id,o.version,?,?,(SELECT legal_hold FROM bf_source_retention WHERE dataset_id=?),(SELECT minimum_retain_until FROM bf_source_retention WHERE dataset_id=?),?,?,?
    FROM oa_operators o WHERE o.email=? AND o.role='owner' AND o.status='active'`,auditId,dataset,current?.revision??null,current?'published':'unpublished',input.previousRevision,revision,dataset,dataset,input.legalHold?1:0,until,input.releaseHold===true?1:0,owner.email),
   sql('INSERT INTO bf_source_retention VALUES(?,?,?,?) ON CONFLICT(dataset_id) DO UPDATE SET revision=excluded.revision,legal_hold=excluded.legal_hold,minimum_retain_until=excluded.minimum_retain_until',dataset,revision,input.legalHold?1:0,until),
  ])
  return json({revision,auditId,legalHold:input.legalHold,minimumRetainUntil:until,automaticErasure:false})
 }catch(error){
  if(error instanceof ConventionsError)return json({error:error.code},error.status)
  return json({error:'retention_conflict',recovery:'Review the current source and policy. Explicitly acknowledge releaseHold when replacing existing retention protection.'},409)
 }
}
