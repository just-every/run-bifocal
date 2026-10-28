import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import type {D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {readQuery,sourceMatch,type Snapshot} from '../data/snapshots/store'
import {readGrant} from '../explore/access.server'
import {modelGuard,readModel} from '../models/validation/store.server'
import {metric,revision,metricGuard,metricValue} from '../metrics/store.server'
import {publishedDashboard} from '../dashboards/interactions.run.server'
import {participantAccess} from './participants.server'
import {fail,QueryError} from '../query/types'
import {answerName} from '../query/name'
export type SubjectKind='answer'|'dashboard'|'chart'|'authored-dashboard'|'metric'
export type Subject={kind:SubjectKind;id:string;key:string;ownerId:string;title:string;href:string;fingerprint:string;guards:D1Sql[];datasets:string[];snapshots:Snapshot[];delegateId:string|null;metricRef:{id:string;revision:number;digest:string}|null}
export async function subject(env:Bindings,actor:Authority,kind:unknown,id:unknown):Promise<Subject>{
 if(!['answer','dashboard','chart','authored-dashboard','metric'].includes(String(kind))||typeof id!=='string'||!(/^[a-f0-9-]{36}$/.test(id)||kind==='metric'&&/^[a-z][a-z0-9-]{0,63}$/.test(id)))fail('collaboration_subject_not_found',404)
 // Explicit reviewed content participation is checked against the recipient's own live grant.
 if(actor.role!=='owner'){
  const row=await env.DB.prepare('SELECT p.*,s.owner_id FROM bf_collaboration_participants p JOIN bf_collaboration_subjects s ON s.key=p.subject_key WHERE s.kind=? AND s.target_id=? AND s.active=1 AND p.operator_id=?').bind(kind,id,actor.id).first<{subject_key:string;owner_id:string;grant_id:string;owner_version:number;operator_version:number}>()
  if(row){
   const owner=await member(env,row.owner_id),person=await member(env,actor.id)
   if(owner.role!=='owner'||owner.version!==row.owner_version||person.version!==row.operator_version)fail('collaboration_subject_changed',409)
   const target=await subject(env,{...actor,id:owner.id,role:owner.role},kind,id)
   if(target.key!==row.subject_key)fail('collaboration_subject_changed',409)
   const guards=await participantAccess(env,actor,target,row.grant_id)
   target.guards.push(...guards,owner.guard,person.guard,sql('EXISTS(SELECT 1 FROM bf_collaboration_participants WHERE subject_key=? AND operator_id=? AND grant_id=? AND owner_version=? AND operator_version=?)',row.subject_key,actor.id,row.grant_id,owner.version,person.version))
   target.href=target.kind==='chart'?'/app/charts/'+target.id:'/app/collaboration/'+target.kind+'/'+target.id
   return target
  }
 }
 const snapshots:Snapshot[]=[],guards:D1Sql[]=[],datasets=new Set<string>();let title='',href='',ownerId=actor.id,delegateId:string|null=null,metricRef:Subject['metricRef']=null,suffix=''
 const addSnapshot=async(snapshotId:string,owner:string)=>{
  const retained=await readQuery(env,actor,owner,snapshotId),snapshot=retained.snapshot
  guards.push(retained.guard,...retained.sources.map(sourceMatch));retained.sources.forEach(s=>datasets.add(s.id));snapshots.push(snapshot)
  if(snapshot.context.exploration){
   const exploration=snapshot.context.exploration,model=await readModel(env,owner,exploration.modelId)
   if(model.production!==exploration.revision)fail('published_model_changed',409)
   guards.push(modelGuard(model))
   if(exploration.operatorId){
    try{
     const person=await member(env,exploration.operatorId),access=await readGrant(env,{...actor,id:person.id},exploration.grantId)
     if((exploration.entitlementRevision??null)!==access.entitlements.revision||(exploration.entitlementDay??null)!==access.entitlements.day)fail('entitlement_snapshot_changed',409)
     if(actor.id!==owner)guards.push(...access.guards,person.guard);delegateId=person.id
    }catch(error){if(actor.id!==owner||!(error instanceof QueryError))throw error}
   }
  }
  if(snapshot.context.metric){
   const ref=snapshot.context.metric,row=await metric(env,owner,ref.id),rev=await revision(env,ref.id,ref.revision)
   if(!rev?.approved_at||rev.digest!==ref.digest)fail('certified_metric_changed',409)
   guards.push(metricGuard(row));metricRef=ref
  }
 }
 if(kind==='answer'){
  const row=await env.DB.prepare("SELECT owner_id,json_extract(context_json,'$.exploration.operatorId') AS operator_id FROM bf_query_snapshots WHERE id=?").bind(id).first<{owner_id:string;operator_id:string|null}>()
  if(!row||actor.id!==row.owner_id&&actor.id!==row.operator_id)fail('collaboration_subject_not_found',404)
  ownerId=row.owner_id
  if(actor.id===ownerId&&actor.role!=='owner')fail('collaboration_subject_not_found',404)
  await addSnapshot(id,ownerId);title=answerName(snapshots[0].definition);href=snapshots[0].context.exploration&&actor.id!==ownerId?'/app/questions/'+id:'/app/queries/'+id
 }else{
  if(actor.role!=='owner')fail('collaboration_subject_not_found',404)
  if(kind==='metric'){
   const row=await metric(env,actor.id,id);if(!row.published_revision)fail('metric_not_certified',409)
   const rev=await revision(env,id,row.published_revision);if(!rev?.approved_at)fail('metric_not_certified',409)
   const evaluated=await metricValue(env,actor.id,row,rev)
   guards.push(metricGuard(row),...evaluated.context.guards??[],...evaluated.sources.map(sourceMatch));evaluated.sources.forEach(s=>datasets.add(s.id))
   const legacy=await env.DB.prepare('SELECT active FROM bf_collaboration_subjects WHERE key=?').bind('metric:'+id+':'+rev.revision).first<{active:number}>()
   metricRef={id,revision:rev.revision,digest:rev.digest};suffix=':'+rev.revision+(legacy?.active?'':':'+sha256(canonicalJson(evaluated.sources.map(s=>({id:s.id,revision:s.revision,digest:sha256(s.value_json)})))));title=evaluated.doc.name;href='/app/metrics/'+id
  }else if(kind==='authored-dashboard'){
   const published=await publishedDashboard(env,actor,actor.id,id);guards.push(...published.guards);suffix=':'+published.revision.revision;title=published.revision.document.title;href='/app/dashboard-authoring/'+id+'/view'
   for(const ref of published.manifest.refs)await addSnapshot(ref.snapshot_id,actor.id)
  }else if(kind==='chart'){
   const row=await env.DB.prepare('SELECT snapshot_id,title FROM bf_charts WHERE id=? AND owner_id=?').bind(id,actor.id).first<{snapshot_id:string;title:string}>()
   if(!row)fail('collaboration_subject_not_found',404)
   title=row.title;href='/app/charts/'+id;await addSnapshot(row.snapshot_id,actor.id)
  }else{
   const board=await env.DB.prepare('SELECT title FROM bf_analytics_boards WHERE id=? AND owner_id=? AND kind=\'dashboard\'').bind(id,actor.id).first<{title:string}>()
   if(board){title=board.title;const refs=(await env.DB.prepare('SELECT snapshot_id FROM bf_analytics_cards WHERE board_id=? ORDER BY position').bind(id).all<{snapshot_id:string}>()).results;if(!refs.length)fail('collaboration_subject_not_found',404);for(const ref of refs)await addSnapshot(ref.snapshot_id,actor.id)}
   else{const row=await env.DB.prepare("SELECT snapshot_id,title FROM bf_query_artifacts WHERE id=? AND owner_id=? AND kind='dashboard'").bind(id,actor.id).first<{snapshot_id:string;title:string}>();if(!row)fail('collaboration_subject_not_found',404);title=row.title;await addSnapshot(row.snapshot_id,actor.id)}
   href='/app/dashboards/'+id
  }
 }
 const key=kind+':'+id+suffix,fingerprint=sha256(canonicalJson({kind,id,ownerId,metricRef,snapshots:snapshots.map(s=>s.digest)}))
 const stored=await env.DB.prepare('SELECT fingerprint,active FROM bf_collaboration_subjects WHERE key=?').bind(key).first<{fingerprint:string;active:number}>()
 if(stored&&(!stored.active||stored.fingerprint!==fingerprint))fail('collaboration_subject_changed',409)
 guards.push(sql('NOT EXISTS(SELECT 1 FROM bf_collaboration_subjects WHERE key=? AND (active=0 OR fingerprint<>?))',key,fingerprint))
 return {kind:kind as SubjectKind,id,key,ownerId,title,href,fingerprint,guards,datasets:[...datasets],snapshots,delegateId,metricRef}
}
export async function member(env:Bindings,id:string){
 const row=await env.DB.prepare("SELECT id,display_name AS displayName,version,role FROM oa_operators WHERE id=? AND status='active'").bind(id).first<{id:string;displayName:string;version:number;role:string}>()
 if(!row)fail('collaboration_recipient_not_permitted',403)
 return {...row,guard:sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=? AND role=?)",row.id,row.version,row.role)}
}
export async function permittedMembers(env:Bindings,actor:Authority,target:Subject){
 const members=[]
 for(const id of new Set([target.ownerId,...target.delegateId?[target.delegateId]:[]])){
  const person=await member(env,id);if(id===target.ownerId&&person.role!=='owner')fail('collaboration_subject_changed',409)
  if(id===target.delegateId){
   const ref=target.snapshots.find(snapshot=>snapshot.context.exploration?.operatorId===id)?.context.exploration
   if(!ref)fail('collaboration_subject_changed',409)
   const access=await readGrant(env,{...actor,id},ref.grantId)
   const checks=[person.guard,...access.guards]
   person.guard=sql(checks.map(check=>'('+check.sql+')').join(' AND '),...checks.flatMap(check=>check.params??[]))
  }
  members.push(person)
 }
 const participants=(await env.DB.prepare('SELECT operator_id,grant_id,owner_version,operator_version FROM bf_collaboration_participants WHERE subject_key=?').bind(target.key).all<{operator_id:string;grant_id:string;owner_version:number;operator_version:number}>()).results
 for(const row of participants){
  if(members.some(person=>person.id===row.operator_id))continue
  try{
   const person=await member(env,row.operator_id),owner=await member(env,target.ownerId)
   if(owner.version!==row.owner_version||person.version!==row.operator_version)continue
   const checks=[person.guard,owner.guard,...await participantAccess(env,{...actor,id:person.id,role:person.role},target,row.grant_id),
    sql('EXISTS(SELECT 1 FROM bf_collaboration_participants WHERE subject_key=? AND operator_id=? AND grant_id=? AND owner_version=? AND operator_version=?)',target.key,person.id,row.grant_id,owner.version,person.version)]
   person.guard=sql(checks.map(check=>'('+check.sql+')').join(' AND '),...checks.flatMap(check=>check.params??[]))
   members.push(person)
  }catch(error){if(!(error instanceof QueryError))throw error}
 }
 await transact(env.DB,actor,[...target.guards.map(assertion),...members.map(m=>assertion(m.guard))]);return members
}
export const subjectChanges=(target:Subject)=>[...target.guards.map(assertion),sql('INSERT OR IGNORE INTO bf_collaboration_subjects(key,kind,target_id,owner_id,fingerprint) VALUES(?,?,?,?,?)',target.key,target.kind,target.id,target.ownerId,target.fingerprint),...target.datasets.map(dataset=>sql('INSERT OR IGNORE INTO bf_collaboration_sources(subject_key,dataset_id) VALUES(?,?)',target.key,dataset))]
