import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {queryContext} from '../query/context'
import {fail} from '../query/types'
import {readSources,saveQuery,sourceMatch} from '../data/snapshots/store'
import {branchGuard,modelGuard,readBranch,readDefinition,readModel} from '../models/validation/store.server'
import {scopedQuery} from '../models/validation/protocol'
import {metric,metricGuard,metricValue,revision} from '../metrics/store.server'
import {estateGuard,history,readEstate,readEstateRevision} from './store.server'
import type {EstateDocument} from './protocol'

/** Environment execution has only the native read-only exact-query door. */
export async function runEnvironment(env:Bindings,actor:Authority,id:string,input:Record<string,unknown>){
 const environment=input.environment
 if(environment!=='development'&&environment!=='staging'&&environment!=='production')fail('invalid_environment',400)
 const state=await readEstate(env,actor,id);if(!state)fail('environment_not_found',404)
 const n=state[environment];if(!n)fail('environment_unpublished',409)
 const stored=await readEstateRevision(env,actor,id,n),document=JSON.parse(stored.document_json) as EstateDocument,ref=document.resources.find(r=>r.key===input.key)
 if(!ref)fail('environment_resource_not_found',404)
 const guards=[estateGuard(actor,id,state)]
 let query,context,sources
 if(ref.kind==='model'){
  const model=await readModel(env,actor.id,ref.id)
  guards.push(modelGuard(model))
  if(environment==='development'){
   const branch=await readBranch(env,model,ref.branchId!)
   if(branch.revision_id!==ref.revisionId)fail('environment_model_branch_changed',409)
   guards.push(branchGuard(branch))
  }else if(model[environment]!==ref.revisionId)fail('environment_model_changed',409)
  const definition=await readDefinition(env,ref.revisionId!),view=definition.views.find(v=>v.id===input.viewId)
  if(!view)fail('environment_view_required',404)
  query=scopedQuery(view,ref.revisionId!);context=await queryContext(env,query,actor.id);sources=await readSources(env,query)
 }else if(ref.kind==='metric'){
  if(input.viewId!==undefined)fail('metric_view_not_supported',400)
  const row=await metric(env,actor.id,ref.id),selected=await revision(env,ref.id,ref.revision!)
  if(!selected)fail('metric_revision_not_found',404)
  if(environment==='production'&&row.published_revision!==ref.revision)fail('environment_metric_changed',409)
  const value=await metricValue(env,actor.id,row,selected)
  query=value.query;context={...value.context,metric:{id:row.id,revision:selected.revision,digest:selected.digest}};sources=value.sources
  guards.push(metricGuard(row),sql('EXISTS(SELECT 1 FROM bf_metric_revisions WHERE metric_id=? AND revision=? AND digest=?)',row.id,selected.revision,selected.digest))
 }else fail('environment_resource_is_retained_definition',400)
 const snapshot=await saveQuery(env,actor,query,{...context,environmentEstate:{id,revision:n,environment,key:ref.key},guards:[...context.guards??[],...guards]},sources)
 // Observe the same pointer after retention; no outbound or write adapter exists.
 await transact(env.DB,actor,[...guards.map(assertion),...sources.map(sourceMatch).map(assertion),history(actor,id,n,environment,'run',snapshot.digest)])
 return {...snapshot,estateId:id,estateRevision:n,environment,productionSends:0,sourceWrites:0}
}
