import {randomUUID} from 'node:crypto'
import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {fail} from '../query/types'
import {history,publicationReview} from './store.server'
import {dashboardPublicationChanges} from '../dashboards/authoring.publication.server'
function securityResolution(value:unknown,required:boolean){
 if(required&&(typeof value!=='string'||!value.trim())||value!==undefined&&(typeof value!=='string'||value.length>1000||!value.trim()))fail('security_resolution_required',409)
 return typeof value==='string'?value:null
}
export async function approveEstate(env:Bindings,actor:Authority,id:string,n:number,digest:unknown,resolution:unknown){
 const prepared=await publicationReview(env,actor,id,n),{review,state,guards}=prepared
 if(!review.compatible||digest!==review.digest)fail('exact_current_environment_review_required',409)
 const text=securityResolution(resolution,review.accessReviewRequired)
 await transact(env.DB,actor,[...guards.map(assertion),sql('INSERT INTO bf_environment_approval(owner_id,estate_id,revision,generation,digest,security_resolution) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,estate_id) DO UPDATE SET revision=excluded.revision,generation=excluded.generation,digest=excluded.digest,security_resolution=excluded.security_resolution',actor.id,id,n,state.generation,review.digest,text),history(actor,id,n,'development','approve',review.digest)])
 return {approved:true,id,version:n,digest:review.digest}
}
export async function promoteEstate(env:Bindings,actor:Authority,id:string,n:number,environment:'staging'|'production',digest:unknown){
 const prepared=await publicationReview(env,actor,id,n),{review,state,resources,guards}=prepared
 const approval=await env.DB.prepare('SELECT * FROM bf_environment_approval WHERE owner_id=? AND estate_id=? AND revision=? AND generation=? AND digest=?').bind(actor.id,id,n,state.generation,review.digest).first<{security_resolution:string|null}>()
 if(!review.compatible||digest!==review.digest||!approval||review.accessReviewRequired&&!approval.security_resolution)fail('exact_current_environment_approval_required',409)
 if(environment==='production'&&state.staging!==n)fail('staging_first_required',409)
 const now=new Date().toISOString(),changes=[...guards.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_environment_approval WHERE owner_id=? AND estate_id=? AND revision=? AND generation=? AND digest=? AND security_resolution IS ?)',actor.id,id,n,state.generation,review.digest,approval.security_resolution))]
 for(const value of resources.models){
  const {model,branch}=value
  if(environment==='production'&&model.staging!==branch.revision_id)fail('native_model_staging_changed',409)
  changes.push(sql('INSERT INTO bf_semantic_approvals(id,model_id,revision_id,digest,actor_id,security_resolution,recorded_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),model.id,branch.revision_id,value.review.digest,actor.id,approval.security_resolution,now),sql(`UPDATE bf_semantic_models SET ${environment}=?,cache_epoch=cache_epoch+1,generation=generation+? WHERE id=?`,branch.revision_id,environment==='production'?1:0,model.id),sql('DELETE FROM bf_semantic_cache WHERE model_id=?',model.id),sql('INSERT INTO bf_semantic_history(id,model_id,environment,revision_id,action,actor_id,cache_epoch,recorded_at) VALUES(?,?,?,?,?,?,?,?)',randomUUID(),model.id,environment,branch.revision_id,'promote',actor.id,model.cache_epoch+1,now))
 }
 if(environment==='production')for(const value of resources.metrics){
  changes.push(sql('UPDATE bf_metric_revisions SET approved_at=COALESCE(approved_at,?),annotation=COALESCE(annotation,?) WHERE metric_id=? AND revision=?',now,'Exact estate approval '+id+' revision '+n,value.row.id,value.revision.revision),sql('UPDATE bf_metrics SET published_revision=? WHERE id=? AND owner_id=?',value.revision.revision,value.row.id,actor.id))
 }
 if(environment==='production')for(const value of resources.dashboards)changes.push(...dashboardPublicationChanges(actor,value.state,value.revision,'publish',review.digest,{estate:true}))
 changes.push(sql(`UPDATE bf_environment_estates SET ${environment}=?,generation=generation+? WHERE owner_id=? AND id=?`,n,environment==='production'?1:0,actor.id,id),history(actor,id,n,environment,'promote',review.digest))
 if(environment==='production')changes.push(sql('DELETE FROM bf_environment_approval WHERE owner_id=? AND estate_id=?',actor.id,id))
 await transact(env.DB,actor,changes)
 return {id,version:n,environment,generation:state.generation+(environment==='production'?1:0),productionSends:0,sourceWrites:0,policiesActive:false,scheduleDispatcher:'unavailable'}
}
export async function rollbackEstate(env:Bindings,actor:Authority,id:string,n:number,generation:unknown,digest:unknown,resolution:unknown){
 const {review,state,resources,guards}=await publicationReview(env,actor,id,n,true)
 if(generation!==state.generation||!review.compatible||digest!==review.digest)fail('exact_current_environment_rollback_required',409)
 const text=securityResolution(resolution,review.accessReviewRequired),now=new Date().toISOString(),changes=[...guards.map(assertion)]
 for(const value of resources.models){
  const {model,branch}=value
  changes.push(sql('INSERT INTO bf_semantic_approvals(id,model_id,revision_id,digest,actor_id,security_resolution,recorded_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),model.id,branch.revision_id,value.review.digest,actor.id,text,now),sql('UPDATE bf_semantic_models SET production=?,staging=?,generation=generation+1,cache_epoch=cache_epoch+1 WHERE id=?',branch.revision_id,branch.revision_id,model.id),sql('DELETE FROM bf_semantic_cache WHERE model_id=?',model.id),sql('INSERT INTO bf_semantic_history(id,model_id,environment,revision_id,action,actor_id,cache_epoch,recorded_at) VALUES(?,?,?,?,?,?,?,?)',randomUUID(),model.id,'production',branch.revision_id,'rollback',actor.id,model.cache_epoch+1,now))
 }
 for(const value of resources.metrics)changes.push(sql('UPDATE bf_metrics SET published_revision=? WHERE id=? AND owner_id=?',value.revision.revision,value.row.id,actor.id))
 for(const value of resources.dashboards)changes.push(...dashboardPublicationChanges(actor,value.state,value.revision,'rollback',review.digest,{estate:true}))
 changes.push(sql('UPDATE bf_environment_estates SET development=?,staging=?,production=?,generation=generation+1 WHERE owner_id=? AND id=?',n,n,n,actor.id,id),sql('DELETE FROM bf_environment_approval WHERE owner_id=? AND estate_id=?',actor.id,id),history(actor,id,n,'production','rollback',review.digest))
 await transact(env.DB,actor,changes)
 return {id,version:n,generation:state.generation+1,productionSends:0,sourceWrites:0,policiesActive:false,scheduleDispatcher:'unavailable'}
}
