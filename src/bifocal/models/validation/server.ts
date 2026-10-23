import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { fileOwner } from '../../imports/files/owner.server'
import { ownerIdentity, readSources, saveQuery, readQuery } from '../../data/snapshots/store'
import { queryContext } from '../../query/context'
import { fail, QueryError } from '../../query/types'
import { definitionInput, scopedQuery } from './protocol'
import { discardBody, exactKeys, json, jsonBody } from './transport'
import { branchGuard, modelGuard, promote, readBranch, readDefinition, readModel, revisionStatement, validateBranch } from './store.server'

/** Same-origin native human sessions only; there is no machine approval door. */
export async function semanticResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/operator\/models(?:\/([a-f0-9-]{36}))?(?:\/(.*))?$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original)
 try {
  const owner=await fileOwner(request,env);if(!owner){await discardBody(request);return json({error:'owner_required'},401)}
  const ownerId=await ownerIdentity(env,owner)
  if(url.search)fail('query_parameters_not_supported',400)
  const [,id,action]=match
  if(!id){
   if(url.pathname!=='/api/operator/models'){await discardBody(request);return json({error:'not_found'},404)}
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['definition'])
   const definition=definitionInput(input.definition),modelId=randomUUID(),branchId=randomUUID(),revision=revisionStatement(modelId,definition)
   await transact(env.DB,owner,[sql('INSERT INTO bf_semantic_models(id,owner_id) VALUES(?,?)',modelId,ownerId),revision.statement,sql('INSERT INTO bf_semantic_branches(id,model_id,base_generation,revision_id) VALUES(?,?,0,?)',branchId,modelId,revision.id)])
   return json({modelId,branchId,revision:revision.id,version:1},201)
  }
  const model=await readModel(env,ownerId,id)
  if(!action){
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   const history=(await env.DB.prepare('SELECT * FROM bf_semantic_history WHERE model_id=? ORDER BY recorded_at,id').bind(id).all()).results
   const approvals=(await env.DB.prepare('SELECT revision_id,digest,actor_id,security_resolution,recorded_at FROM bf_semantic_approvals WHERE model_id=? ORDER BY recorded_at,id').bind(id).all()).results
   const cache=(await env.DB.prepare('SELECT environment,view_id,snapshot_id,epoch FROM bf_semantic_cache WHERE model_id=?').bind(id).all()).results
   await transact(env.DB,owner,[assertion(modelGuard(model))])
   return json({...model,history,cache,approvals})
  }
  if(action==='branches'){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['definition'])
   const definition=definitionInput(input.definition),branchId=randomUUID(),revision=revisionStatement(id,definition)
   await transact(env.DB,owner,[assertion(modelGuard(model)),revision.statement,sql('INSERT INTO bf_semantic_branches(id,model_id,base_generation,revision_id) VALUES(?,?,?,?)',branchId,id,model.generation,revision.id)])
   return json({modelId:id,branchId,revision:revision.id,version:1},201)
  }
  const branchMatch=/^branches\/([a-f0-9-]{36})(?:\/(validate|approve|promote))?$/.exec(action)
  if(branchMatch){
   const branch=await readBranch(env,model,branchMatch[1]),operation=branchMatch[2]
   if(!operation){
    if(request.method==='GET'){
     const definition=await readDefinition(env,branch.revision_id)
     await transact(env.DB,owner,[assertion(modelGuard(model)),assertion(branchGuard(branch))])
     return json({...branch,definition})
    }
    if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
    const input=await jsonBody(request);exactKeys(input,['definition','previousVersion'])
    if(input.previousVersion!==branch.version)fail('stale_branch_version',409)
    const definition=definitionInput(input.definition),revision=revisionStatement(id,definition)
    await transact(env.DB,owner,[assertion(modelGuard(model)),assertion(branchGuard(branch)),revision.statement,sql('UPDATE bf_semantic_branches SET revision_id=?,version=version+1,approval_json=NULL WHERE id=?',revision.id,branch.id)])
    return json({branchId:branch.id,revision:revision.id,version:branch.version+1})
   }
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request)
   if(operation==='promote'){
    exactKeys(input,['environment','digest']);if(input.environment!=='staging'&&input.environment!=='production')fail('invalid_environment',400)
    return json(await promote(env,owner,model,branch,input.environment,input.digest))
   }
   const {review,guards}=await validateBranch(env,model,branch)
   if(operation==='validate'){
    exactKeys(input,[]);await transact(env.DB,owner,guards.map(assertion));return json(review)
   }
   exactKeys(input,['digest','securityResolution'])
   if(branch.base_generation!==model.generation || input.digest!==review.digest || !review.compatible)fail('exact_current_review_required',409)
   if(input.securityResolution!==undefined && (typeof input.securityResolution!=='string' || !input.securityResolution.trim() || input.securityResolution.length>1000))fail('invalid_security_resolution',400)
   if(review.accessReviewRequired && !input.securityResolution)fail('security_resolution_required',409)
   const approval={digest:review.digest,ownerId,securityResolution:input.securityResolution??null,reviewedAt:new Date().toISOString()}
   await transact(env.DB,owner,[...guards.map(assertion),sql('UPDATE bf_semantic_branches SET approval_json=? WHERE id=?',JSON.stringify(approval),branch.id),sql('INSERT INTO bf_semantic_approvals(id,model_id,revision_id,digest,actor_id,security_resolution,recorded_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),id,branch.revision_id,review.digest,ownerId,approval.securityResolution,approval.reviewedAt)])
   return json({approved:true,...approval})
  }
  if(action==='rollback' || action==='rollback-preview'){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['revision','previousGeneration','digest','securityResolution'])
   if(action==='rollback' && input.previousGeneration!==model.generation || typeof input.revision!=='string')fail('exact_rollback_review_required',409)
   const history=await env.DB.prepare("SELECT id FROM bf_semantic_history WHERE model_id=? AND revision_id=? AND environment='production'").bind(id,input.revision).first()
   if(!history)fail('production_revision_required',409)
   const {review,guards}=await validateBranch(env,model,{id:'rollback',model_id:id,base_generation:model.generation,revision_id:input.revision,version:model.generation,approval_json:null})
   if(action==='rollback-preview'){await transact(env.DB,owner,guards.map(assertion));return json(review)}
   if(!review.compatible || input.digest!==review.digest)fail('exact_current_review_required',409)
   if(review.accessReviewRequired && (typeof input.securityResolution!=='string' || !input.securityResolution.trim() || input.securityResolution.length>1000))fail('security_resolution_required',409)
   const epoch=model.cache_epoch+1
   // A rollback is itself a current human review of a previously approved full
   // definition. Both environments move together; no stale staging survives.
   await transact(env.DB,owner,[...guards.map(assertion),sql('INSERT INTO bf_semantic_approvals(id,model_id,revision_id,digest,actor_id,security_resolution,recorded_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),id,input.revision,review.digest,ownerId,typeof input.securityResolution==='string'?input.securityResolution:null,new Date().toISOString()),sql('UPDATE bf_semantic_models SET production=?,staging=?,generation=generation+1,cache_epoch=? WHERE id=?',input.revision,input.revision,epoch,id),sql('DELETE FROM bf_semantic_cache WHERE model_id=?',id),sql('INSERT INTO bf_semantic_history(id,model_id,environment,revision_id,action,actor_id,cache_epoch,recorded_at) VALUES(?,?,?,?,?,?,?,?)',randomUUID(),id,'production',input.revision,'rollback',ownerId,epoch,new Date().toISOString())])
   return json({revision:input.revision,cacheEpoch:epoch,generation:model.generation+1})
  }
  const run=/^(production|staging)\/run$/.exec(action)
  if(run){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['viewId'])
   const environment=run[1] as 'production'|'staging',revision=model[environment]
   if(!revision)fail('environment_unpublished',409)
   const definition=await readDefinition(env,revision),view=definition.views.find(v=>v.id===input.viewId)
   if(!view)fail('view_not_found',404)
   const query=scopedQuery(view,revision),context=await queryContext(env,query,ownerId),sources=await readSources(env,query)
   // Save an immutable answer with the environment version. SaveQuery fences
   // source revisions and native conventions; the model guard fences promotion.
   context.guards=[...context.guards??[],modelGuard(model)]
   const snapshot=await saveQuery(env,owner,query,context,sources)
   await readQuery(env,owner,ownerId,snapshot.snapshotId)
   await transact(env.DB,owner,[assertion(modelGuard(model)),sql('INSERT INTO bf_semantic_cache(model_id,environment,view_id,snapshot_id,epoch) VALUES(?,?,?,?,?) ON CONFLICT(model_id,environment,view_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,epoch=excluded.epoch',id,environment,view.id,snapshot.snapshotId,model.cache_epoch)])
   return json({...snapshot,modelId:id,environment,revision,cacheEpoch:model.cache_epoch,productionSends:0,sourceWrites:0},201)
  }
  return json({error:'not_found'},404)
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'semantic_conflict',reason:'The current authority, source, conventions or exact reviewed model changed. No publication was committed.'},409)}
}
