import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {readDefinition,readModel,modelGuard} from '../models/validation/store.server'
import {scopedQuery} from '../models/validation/protocol'
import {queryInput} from '../query/validate'
import {readGrant} from '../explore/access.server'
import {member,subject,subjectChanges,type Subject} from './subjects.server'
import {audit} from './links.server'
import {exactKeys,json} from '../models/validation/transport'
import {fail} from '../query/types'

/** Content discussion approval never expands an existing analytical grant. */
export async function participantAccess(env:Bindings,actor:Authority,target:Subject,grantId:string){
 const access=await readGrant(env,actor,grantId),candidate=access.grant
 if(candidate.owner_id!==target.ownerId||!target.snapshots.length)fail('collaboration_projection_not_permitted',403)
 for(const snapshot of target.snapshots){
  const exploration=snapshot.context.exploration
  if(!exploration?.grantId){
   const definition=candidate.definition,model=await readModel(env,candidate.owner_id,definition.modelId)
   if(model.production!==definition.revision)fail('collaboration_projection_not_permitted',403)
   const view=(await readDefinition(env,definition.revision)).views.find(item=>item.id===definition.viewId)
   if(!view)fail('collaboration_projection_not_permitted',403)
   if(!definition.underlying&&snapshot.definition.groupBy.some(column=>!definition.dimensions.includes(column)))fail('collaboration_projection_not_permitted',403)
   const expected=queryInput({...scopedQuery(view,definition.revision),groupBy:snapshot.definition.groupBy,filters:[...view.query.filters,...view.rowRules,...definition.filters]})
   if(canonicalJson(expected)!==canonicalJson(snapshot.definition))fail('collaboration_projection_not_permitted',403)
   access.guards.push(modelGuard(model))
   continue
  }
  const original=await env.DB.prepare('SELECT definition_json FROM bf_explore_grants WHERE id=? AND owner_id=?').bind(exploration.grantId,target.ownerId).first<{definition_json:string}>()
  if(!original)fail('collaboration_projection_not_permitted',403)
  const retained=JSON.parse(original.definition_json)
  for(const key of ['modelId','revision','viewId','filters','dimensions','underlying','sources'] as const){
   if(canonicalJson(retained[key])!==canonicalJson(candidate.definition[key]))fail('collaboration_projection_not_permitted',403)
  }
 }
 return access.guards
}
export async function participantResponse(env:Bindings,actor:Authority,path:string,input:Record<string,unknown>){
 if(actor.role!=='owner')fail('owner_required',403)
 if(path.endsWith('/revoke')){
  exactKeys(input,['kind','id','operatorId'])
  const target=await subject(env,actor,input.kind,input.id)
  if(typeof input.operatorId!=='string')fail('collaboration_recipient_not_permitted',403)
  await transact(env.DB,actor,[...target.guards.map(assertion),
   sql('DELETE FROM bf_collaboration_participants WHERE subject_key=? AND operator_id=?',target.key,input.operatorId),
   sql('UPDATE bf_collaboration_links SET revoked=1 WHERE subject_key=? AND (issuer_id=? OR recipient_id=?)',target.key,input.operatorId,input.operatorId),
   audit(actor,'discussion-participant-revoked',input.operatorId)])
  return json({revoked:true},200)
 }
 exactKeys(input,['kind','id','operatorId','grantId','reviewedDigest'])
 const target=await subject(env,actor,input.kind,input.id)
 if(typeof input.operatorId!=='string'||typeof input.grantId!=='string')fail('collaboration_recipient_not_permitted',403)
 const person=await member(env,input.operatorId),owner=await member(env,actor.id)
 const access=await participantAccess(env,{...actor,id:person.id,role:person.role},target,input.grantId)
 const guards=[...target.guards,...access,person.guard,owner.guard]
 const digest=sha256(canonicalJson({key:target.key,fingerprint:target.fingerprint,operatorId:person.id,grantId:input.grantId,guards}))
 if(path.endsWith('/review')){await transact(env.DB,actor,guards.map(assertion));return json({digest,subject:target.title,operatorId:person.id},200)}
 if(input.reviewedDigest!==digest)fail('exact_collaboration_review_required',409)
 await transact(env.DB,actor,[...subjectChanges(target),...guards.map(assertion),
 sql('INSERT OR REPLACE INTO bf_collaboration_participants(subject_key,operator_id,grant_id,owner_version,operator_version) VALUES(?,?,?,?,?)',target.key,person.id,input.grantId,owner.version,person.version),
 audit(actor,'discussion-participant-approved',person.id)])
 return json({approved:true},201)
}
