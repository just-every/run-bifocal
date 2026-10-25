import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Authority } from '../catalog/authority.server'
import { readQuery, readSources, sourceMatch } from '../data/snapshots/store'
import { readChart } from '../charts/store.server'
import { readBoard } from '../dashboards/store.server'
import { readDashboardDefinition,readDashboardDefinitionRevision,dashboardDefinitionGuard,dashboardRevisionGuard } from '../dashboards/authoring.store.server'
import { metric, metricGuard, metricValue, revision, type MetricRow, type Revision } from '../metrics/store.server'
import { branchGuard, modelGuard, readBranch, readDefinition, readModel, validateBranch, type Branch, type Model } from '../models/validation/store.server'
import { scopedQuery } from '../models/validation/protocol'
import { policyInput, validatePolicyScope } from '../policies/protocol'
import { policyGuard, readPolicy, type PolicyVersion } from '../policies/store.server'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, type Context, type Query } from '../query/types'
import { readVersion } from '../company/store'
import { resolveSchedule, scheduleDefinition } from '../calendars/timezone'
import { recurringDocument } from '../schedules/protocol'
import { resolveRecurrence } from '../schedules/recurrence'
import type { EstateDocument } from './protocol'
import { nativeModelDependency } from './dependencies.server'

type Resource=EstateDocument['resources'][number]
type CheckedModel={model:Model;branch:Branch;review:Awaited<ReturnType<typeof validateBranch>>['review']}
const hash=(value:unknown)=>sha256(canonicalJson(value))
const conventions=(context:Context)=>({company:hash(context.company),calendar:hash(context.calendar),rateSource:hash(context.rateSource),timezone:context.timezone,currency:context.currency})

/** Private transaction inputs stay separate from the portable definitions.
 * Resolving an estate never publishes, certifies, activates or sends anything. */
export async function resolveResources(env:Bindings,actor:Authority,document:EstateDocument,rollback=false) {
 if(actor.role!=='owner')fail('owner_required',403)
 const definitions:{key:string;kind:Resource['kind'];id:string;definition:unknown}[]=[],guards:D1Sql[]=[actor]
 const sourceIds=new Set<string>()
 const dashboards:{state:NonNullable<Awaited<ReturnType<typeof readDashboardDefinition>>>;revision:Awaited<ReturnType<typeof readDashboardDefinitionRevision>>}[]=[],models:CheckedModel[]=[],metrics:{row:MetricRow;revision:Revision}[]=[],fingerprints:unknown[]=[]
 const add=(ref:Resource,definition:unknown,binding:Record<string,unknown>={})=>{
  definitions.push({key:ref.key,kind:ref.kind,id:ref.id,definition})
  fingerprints.push({key:ref.key,kind:ref.kind,id:ref.id,definitionHash:hash(definition),...binding})
 }
 const inspectQuery=async(key:string,query:Query,checkDependency=true)=>{
  if(checkDependency)guards.push(...await nativeModelDependency(env,actor,document,query))
  const context=await queryContext(env,query,actor.id),sources=await readSources(env,query),answer=execute(query,sources,context)
  sources.forEach(source=>sourceIds.add(source.id))
  guards.push(...context.guards??[],...sources.map(sourceMatch))
  fingerprints.push({key,definitionHash:hash(query),sourceWatermarks:answer.sourceWatermarks,conventions:conventions(context)})
 }
 const definitionGuard=(modelId:string,revisionId:string,definition:unknown)=>sql('EXISTS(SELECT 1 FROM bf_semantic_revisions WHERE id=? AND model_id=? AND definition_json=?)',revisionId,modelId,canonicalJson(definition))

 for(const ref of document.resources) {
  if(ref.kind==='model') {
   if(!ref.branchId||!ref.revisionId)fail('estate_model_revision_required',400)
   const model=await readModel(env,actor.id,ref.id)
   const retained=await env.DB.prepare('SELECT definition_json FROM bf_semantic_revisions WHERE id=? AND model_id=?').bind(ref.revisionId,model.id).first<{definition_json:string}>()
   if(!retained)fail('estate_model_revision_not_found',404)
   let branch:Branch
   if(rollback) {
    const history=sql("EXISTS(SELECT 1 FROM bf_semantic_history WHERE model_id=? AND revision_id=? AND environment='production')",model.id,ref.revisionId)
    if(!await env.DB.prepare('SELECT 1 AS ok WHERE '+history.sql).bind(...history.params??[]).first())fail('estate_model_rollback_not_published',409)
    guards.push(history)
    branch={id:'rollback',model_id:model.id,base_generation:model.generation,revision_id:ref.revisionId,version:model.generation,approval_json:null}
   } else {
    branch=await readBranch(env,model,ref.branchId)
    if(branch.revision_id!==ref.revisionId)fail('estate_model_branch_changed',409)
   }
   const validationBranch=!rollback&&branch.base_generation!==model.generation&&branch.revision_id===model.production
    ?{...branch,id:'rollback',base_generation:model.generation,version:model.generation}
    :branch
   const checked=await validateBranch(env,model,validationBranch)
   if(!checked.review.compatible)fail('estate_model_validation_failed',409)
   const definition=JSON.parse(retained.definition_json)
   guards.push(...checked.guards,...rollback?[]:[branchGuard(branch)],sql('EXISTS(SELECT 1 FROM bf_semantic_revisions WHERE id=? AND model_id=? AND definition_json=?)',ref.revisionId,model.id,retained.definition_json))
   models.push({model,branch,review:checked.review})
   add(ref,definition,{revision:ref.revisionId,production:model.production,generation:model.generation,reviewDigest:checked.review.digest})
   // Validation includes old and new numerical answers; only safe context hashes and
   // watermarks become estate fingerprints, never those answer rows.
   for(const view of definition.views)await inspectQuery(ref.key+'.candidate.'+view.id,scopedQuery(view,ref.revisionId))
   if(model.production)for(const view of (await readDefinition(env,model.production)).views)await inspectQuery(ref.key+'.production.'+view.id,scopedQuery(view,model.production),false)
   continue
  }
  if(ref.kind==='metric') {
   if(!Number.isSafeInteger(ref.revision)||Number(ref.revision)<1)fail('estate_metric_revision_required',400)
   const row=await metric(env,actor.id,ref.id),rev=await revision(env,ref.id,ref.revision!)
   if(!rev)fail('estate_metric_revision_not_found',404)
   guards.push(...await nativeModelDependency(env,actor,document,JSON.parse(rev.document_json).query))
   const evaluation=await metricValue(env,actor.id,row,rev)
   guards.push(metricGuard(row),sql('EXISTS(SELECT 1 FROM bf_metric_revisions WHERE metric_id=? AND revision=? AND digest=? AND document_json=? AND approved_at IS ?)',row.id,rev.revision,rev.digest,rev.document_json,rev.approved_at),...evaluation.context.guards??[],...evaluation.sources.map(sourceMatch))
   evaluation.sources.forEach(source=>sourceIds.add(source.id))
   metrics.push({row,revision:rev})
   add(ref,{version:1,id:row.id,definition:evaluation.doc},{revision:rev.revision,digest:rev.digest,headRevision:row.head_revision,publishedRevision:row.published_revision,sourceWatermarks:evaluation.answer.sourceWatermarks,conventions:conventions(evaluation.context)})
   continue
  }
  if(ref.kind==='chart') {
   const chart=await readChart(env,actor,actor.id,ref.id),stored=await env.DB.prepare('SELECT visual_json,created_at FROM bf_charts WHERE id=? AND owner_id=? AND snapshot_id=? AND title=?').bind(ref.id,actor.id,chart.snapshotId,chart.title).first<{visual_json:string;created_at:string}>()
   if(!stored)fail('estate_chart_changed',409)
   const retained=await readQuery(env,actor,actor.id,chart.snapshotId)
   guards.push(retained.guard,sql('EXISTS(SELECT 1 FROM bf_charts WHERE id=? AND owner_id=? AND snapshot_id=? AND title=? AND visual_json=? AND created_at=?)',ref.id,actor.id,chart.snapshotId,chart.title,stored.visual_json,stored.created_at))
   add(ref,{version:1,title:chart.title,definition:chart.definition,visual:chart.visual},{snapshotDigest:retained.snapshot.digest})
   await inspectQuery(ref.key,chart.definition)
   continue
  }
  if(ref.kind==='dashboard'&&ref.revision!==undefined) {
   const state=await readDashboardDefinition(env,actor,ref.id)
   if(!state)fail('estate_dashboard_definition_not_found',404)
   const selected=await readDashboardDefinitionRevision(env,actor,ref.id,ref.revision)
   if(rollback&&!selected.wasPublished)fail('estate_dashboard_revision_not_publishable',409)
   const board=await readBoard(env,actor,actor.id,selected.boardId,'dashboard')
   if(!board)fail('estate_dashboard_withdrawn',404)
   guards.push(dashboardDefinitionGuard(actor,ref.id,state),dashboardRevisionGuard(actor,ref.id,selected),...board.guards)
   dashboards.push({state,revision:selected})
   add(ref,selected.document,{revision:selected.revision,headRevision:state.revision,publishedRevision:state.publishedRevision,generation:state.generation,snapshotDigest:board.digest})
   for(const card of selected.document.cards)await inspectQuery(ref.key+'.'+card.key,card.definition)
   continue
  }
  if(ref.kind==='dashboard'||ref.kind==='report') {
   const board=await readBoard(env,actor,actor.id,ref.id,ref.kind)
   if(board) {
    guards.push(...board.guards)
    add(ref,{version:1,title:board.title,cards:board.cards.map(card=>card.definition)},{snapshotDigest:board.digest})
    for(let i=0;i<board.cards.length;i++)await inspectQuery(ref.key+'.'+i,board.cards[i].definition)
   } else {
    const artifact=await env.DB.prepare('SELECT snapshot_id,title,created_at FROM bf_query_artifacts WHERE id=? AND owner_id=? AND kind=?').bind(ref.id,actor.id,ref.kind).first<{snapshot_id:string;title:string;created_at:string}>()
    if(!artifact)fail('estate_artifact_not_found',404)
    const retained=await readQuery(env,actor,actor.id,artifact.snapshot_id)
    guards.push(retained.guard,sql('EXISTS(SELECT 1 FROM bf_query_artifacts WHERE id=? AND owner_id=? AND kind=? AND snapshot_id=? AND title=? AND created_at=?)',ref.id,actor.id,ref.kind,artifact.snapshot_id,artifact.title,artifact.created_at))
    add(ref,{version:1,title:artifact.title,definition:retained.snapshot.definition},{snapshotDigest:retained.snapshot.digest})
    await inspectQuery(ref.key,retained.snapshot.definition)
   }
   continue
  }
  if(ref.kind==='policy') {
   if(!Number.isSafeInteger(ref.revision)||Number(ref.revision)<1)fail('estate_policy_revision_required',400)
   const current=await readPolicy(env,actor,ref.id)
   if(!current)fail('estate_policy_not_found',404)
   const retained=await env.DB.prepare('SELECT revision,document_json,digest,created_at FROM bf_policy_definition_revisions WHERE owner_id=? AND policy_id=? AND revision=?').bind(actor.id,ref.id,ref.revision).first<PolicyVersion>()
   if(!retained)fail('estate_policy_revision_not_found',404)
   const policy=policyInput(JSON.parse(retained.document_json)),model=await readModel(env,actor.id,policy.modelId)
   const selected=document.resources.find(resource=>resource.kind==='model'&&resource.id===model.id),targetRevision=selected?.revisionId??model.production
   if(!targetRevision)fail('estate_policy_model_unpublished',409)
   const modelDefinition=await readDefinition(env,targetRevision),view=modelDefinition.views.find(v=>v.id===policy.viewId)
   if(!view?.query.semantic)fail('governed_view_required',404)
   validatePolicyScope(policy,view.query)
   guards.push(policyGuard(actor,ref.id,current.revision),modelGuard(model),definitionGuard(model.id,targetRevision,modelDefinition),sql('EXISTS(SELECT 1 FROM bf_policy_definition_revisions WHERE owner_id=? AND policy_id=? AND revision=? AND digest=? AND document_json=?)',actor.id,ref.id,retained.revision,retained.digest,retained.document_json))
   add(ref,policy,{revision:retained.revision,headRevision:current.revision,digest:retained.digest,bindingRevision:targetRevision,production:model.production,generation:model.generation})
   await inspectQuery(ref.key,scopedQuery(view,targetRevision),!!selected)
   continue
  }
  if(ref.kind==='schedule') {
   if(!Number.isSafeInteger(ref.version)||Number(ref.version)<1)fail('estate_schedule_version_required',400)
   const row=await readVersion(env,actor,'bf_schedules',ref.id,ref.version!),stored=JSON.parse(row.value_json)
   const latest=await env.DB.prepare('SELECT MAX(version) AS version FROM bf_schedules WHERE id=?').bind(ref.id).first<{version:number}>()
   if(!latest?.version)fail('estate_schedule_not_found',404)
   guards.push(sql('EXISTS(SELECT 1 FROM bf_schedules WHERE id=? AND version=? AND value_json=? AND created_by=?)',ref.id,row.version,row.value_json,row.created_by),sql('(SELECT MAX(version) FROM bf_schedules WHERE id=?)=?',ref.id,latest.version))
   const company=await env.DB.prepare('SELECT revision,value_json FROM bf_company_settings WHERE singleton=1').first<{revision:string;value_json:string}>()
   if(!company)fail('company_conventions_required',409)
   guards.push(sql('EXISTS(SELECT 1 FROM bf_company_settings WHERE singleton=1 AND revision=? AND value_json=?)',company.revision,company.value_json))
   if(stored.document?.version===2) {
    const schedule=recurringDocument(stored.document),target=schedule.definition.target,model=await readModel(env,actor.id,target.modelId)
    const selected=document.resources.find(r=>r.kind==='model'&&r.id===model.id)
    const branch=target.environment==='development'?await readBranch(env,model,target.branchId!):null
    if(branch&&branch.base_generation!==model.generation)fail('stale_model_branch',409)
    if(branch&&selected&&selected.branchId!==branch.id)fail('estate_schedule_branch_mismatch',409)
    const targetRevision=selected?.revisionId??branch?.revision_id??(target.environment==='production'?model.production:model.staging)
    if(!targetRevision)fail('schedule_environment_unpublished',409)
    const modelDefinition=await readDefinition(env,targetRevision),view=modelDefinition.views.find(v=>v.id===target.viewId)
    if(!view)fail('schedule_view_not_found',404)
    guards.push(modelGuard(model),definitionGuard(model.id,targetRevision,modelDefinition),...branch?[branchGuard(branch)]:[])
    add(ref,schedule,{version:row.version,headVersion:latest.version,storedDigest:hash(stored),company:hash(company),resolutionHash:hash(resolveRecurrence(schedule)),target:{revision:targetRevision,generation:model.generation,...branch?{branchVersion:branch.version}:{}}})
    await inspectQuery(ref.key,scopedQuery(view,targetRevision))
   } else {
    const {resolution:ignoredResolution,dispatcher:ignoredDispatcher,...raw}=stored,definition=scheduleDefinition(raw)
    add(ref,{version:1,id:row.id,definition},{version:row.version,headVersion:latest.version,storedDigest:hash(stored),company:hash(company),resolutionHash:hash(resolveSchedule(definition))})
   }
   continue
  }
  fail('unsupported_estate_resource',400)
 }
 return {definitions,guards:[...new Map(guards.map(guard=>[canonicalJson(guard),guard])).values()],models,metrics,dashboards,fingerprints,sourceIds:[...sourceIds]}
}
