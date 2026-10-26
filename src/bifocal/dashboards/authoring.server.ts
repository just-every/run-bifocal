import {dashboardSnapshotResponse} from './snapshots/response.server'
import {dashboardInteractionsResponse} from './interactions.server'
import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import { assertion, transact } from '../../modules/import-kit/src/door/store.ts'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'
import { dashboardId, dashboardRevision } from './authoring.protocol'
import { applyDashboardDefinition, prepareDashboardDefinition } from './authoring.prepare.server'
import { dashboardDefinitionGuard, readDashboardDefinition } from './authoring.store.server'
import { dashboardPublicationChanges, prepareDashboardPublication } from './authoring.publication.server'

/** Native owner-only authoring reuses the existing exact-query admission. */
export async function dashboardAuthoringResponse(request:Request,env:Bindings,actor:Authority):Promise<Response|null> {
 const path=new URL(request.url).pathname,prefix='/api/operator/dashboard-authoring'
 if(path!==prefix&&!path.startsWith(prefix+'/'))return null
 try {
  if(actor.role!=='owner')fail('owner_required',403)
  const snapshot=await dashboardSnapshotResponse(request,env,actor);if(snapshot)return snapshot
  const interaction=await dashboardInteractionsResponse(request,env,actor);if(interaction)return interaction
  if(path===prefix) {
   if(request.method!=='GET')fail('method_not_allowed',405)
   const ids=(await env.DB.prepare('SELECT id FROM bf_dashboard_definitions WHERE owner_id=? ORDER BY id LIMIT 101').bind(actor.id).all<{id:string}>()).results
   if(ids.length>100)fail('dashboard_definition_list_limit',413)
   const dashboards=[];for(const row of ids){const resource=await readDashboardDefinition(env,actor,row.id);if(resource)dashboards.push(resource)}
   await transact(env.DB,actor,dashboards.map(resource=>assertion(dashboardDefinitionGuard(actor,resource.id,resource))))
   return json({dashboards})
  }
  if(path===prefix+'/review'||path===prefix+'/apply') {
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request),apply=path.endsWith('/apply');exactKeys(input,['document','id','previousRevision',...apply?['reviewedDigest']:[]])
   if(apply)return json(await applyDashboardDefinition(env,actor,input),201)
   const prepared=await prepareDashboardDefinition(env,actor,input.document,input.id,input.previousRevision)
   await transact(env.DB,actor,prepared.guards.map(assertion));return json(prepared.review)
  }
  const match=/^\/api\/operator\/dashboard-authoring\/([^/]+)(\/publication\/review|\/publish|\/rollback)?$/.exec(path)
  if(!match)fail('not_found',404)
  const id=dashboardId(match[1])
  if(!match[2]) {
   if(request.method!=='GET')fail('method_not_allowed',405)
   const resource=await readDashboardDefinition(env,actor,id)
   if(!resource)fail('dashboard_definition_not_found',404)
   await transact(env.DB,actor,[assertion(dashboardDefinitionGuard(actor,id,resource))]);return json(resource)
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request),review=match[2]==='/publication/review';exactKeys(input,['revision','previousGeneration',...review?['action']:['reviewedDigest']])
  const prepared=await prepareDashboardPublication(env,actor,id,dashboardRevision(input.revision),input.previousGeneration,review?input.action:match[2].slice(1))
  if(review){await transact(env.DB,actor,prepared.guards.map(assertion));return json(prepared.review)}
  if(input.reviewedDigest!==prepared.review.digest)fail('exact_dashboard_publication_review_required',409)
  await transact(env.DB,actor,[...prepared.guards.map(assertion),...dashboardPublicationChanges(actor,prepared.state,prepared.revision,prepared.review.action,prepared.review.digest)])
  return json((await readDashboardDefinition(env,actor,id))!)
 }catch(error){return error instanceof QueryError?json({error:error.code},error.status):json({error:'dashboard_definition_conflict'},409)}finally{await discardBody(request)}
}
