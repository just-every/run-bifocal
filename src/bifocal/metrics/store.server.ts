import { rejectedUpload } from '../http/rejected'
import { runtimeBindings, operatorAuth, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity, readSources, saveQuery, sourceMatch } from '../data/snapshots/store'
import { queryInput } from '../query/validate'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, QueryError, type Query } from '../query/types'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { document, exact, ident, input, json, object, result, text } from './transport'
import { refusalLine } from './forms'
import { metricMain, metricsMain, type MetricView } from './pages'
import { metricRefusal } from './refusals'
import { goalPeriod } from '../goals/period'
export type MetricDocument={name:string;description:string;grain:string;unit:string;timezone:string;accountingBasis:string;query:Query}
export type MetricRow={id:string;owner_id:string;head_revision:number;published_revision:number|null;deprecated_at:string|null;deprecated_by:string|null;deprecated_reason:string|null}
export type Revision={metric_id:string;revision:number;dataset_id:string;document_json:string;digest:string;created_at:string;approved_at:string|null;annotation:string|null}
export async function metric(env:Bindings,ownerId:string,id:string) {
 const row=await env.DB.prepare('SELECT * FROM bf_metrics WHERE id=? AND owner_id=?').bind(id,ownerId).first<MetricRow>()
 if(!row)fail('metric_not_found',404)
 return row
}
export const revision=(env:Bindings,id:string,n:number)=>env.DB.prepare('SELECT * FROM bf_metric_revisions WHERE metric_id=? AND revision=?').bind(id,n).first<Revision>()
export const metricGuard=(row:MetricRow)=>sql('EXISTS(SELECT 1 FROM bf_metrics WHERE id=? AND owner_id=? AND head_revision=? AND published_revision IS ? AND deprecated_at IS ?)',row.id,row.owner_id,row.head_revision,row.published_revision,row.deprecated_at)
export function metricDefinition(v:unknown):MetricDocument {
 if(typeof v==='string'){try{v=JSON.parse(v)}catch{fail('invalid_metric_definition',400)}}
 if(!object(v))fail('metric_definition_required',400)
 exact(v,['name','description','grain','unit','timezone','accountingBasis','query'])
 const query=queryInput(v.query)
 if(query.joins.length||query.groupBy.length||query.measures.length!==1)fail('metric_requires_one_scalar_single_source_measure',400)
 const doc={name:text(v.name,160),description:text(v.description,1000),grain:text(v.grain),unit:text(v.unit,32),timezone:text(v.timezone,100),accountingBasis:text(v.accountingBasis,32),query}
 try{new Intl.DateTimeFormat('en',{timeZone:doc.timezone})}catch{fail('invalid_metric_timezone',400)}
 if(doc.unit!==query.measures[0].unit||doc.accountingBasis!==query.context.accountingBasis)fail('metric_semantics_mismatch',400)
 return doc
}
export async function metricValue(env:Bindings,ownerId:string,row:MetricRow,rev:Revision) {
 if(row.deprecated_at)fail('metric_deprecated',409)
 const doc=JSON.parse(rev.document_json) as MetricDocument,query=structuredClone(doc.query)
 query.context.metricVersion=`metric:${row.id}:${rev.revision}`
 const context=await queryContext(env,query,ownerId),sources=await readSources(env,query)
 if(context.timezone!==doc.timezone)fail('metric_timezone_changed',409)
 const answer=execute(query,sources,context)
 return {doc,query,context,sources,answer,value:answer.totals[query.measures[0].id]}
}
export async function runMetric(env:Bindings,owner:NonNullable<Awaited<ReturnType<typeof fileOwner>>>,ownerId:string,id:string) {
 const row=await metric(env,ownerId,id)
 if(!row.published_revision)fail('metric_not_certified',409)
 const rev=(await revision(env,id,row.published_revision))!,evaluation=await metricValue(env,ownerId,row,rev)
 if(evaluation.value.state!=='value')fail('metric_value_unavailable',409)
 return saveQuery(env,owner,evaluation.query,{...evaluation.context,metric:{id,revision:rev.revision,digest:rev.digest},guards:[...evaluation.context.guards??[],metricGuard(row),sql('EXISTS(SELECT 1 FROM bf_metric_revisions WHERE metric_id=? AND revision=? AND digest=? AND approved_at IS NOT NULL)',id,rev.revision,rev.digest)]},evaluation.sources)
}
async function handleMetricResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith('/app/metrics'),match=/^\/(?:api\/operator|app)\/metrics(?:\/([a-z][a-z0-9-]{0,63}))?(?:\/(propose|approve|run|impact|deprecate))?$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return page?new Response('Current installation owner required.',{status:403,headers:{'cache-control':'no-store'}}):json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),viewer=(await operatorAuth(env).getSession(request))!.operator
 const id=match[1],action=match[2]
 let data:Record<string,unknown>={}
 try {
  if(url.search)fail('query_parameters_not_supported',400)
  if(request.method==='POST') {
   data=await input(request)
   if(!id||action==='propose') {
    exact(data,!id?['id','definition']:['previousRevision','definition'])
    const {prepareMetricDraft,saveMetricDraft}=await import('./drafts.server')
    const key=id??ident(data.id),prepared=await prepareMetricDraft(env,ownerId,key,data.definition,id?Number(data.previousRevision):null)
    const saved=await saveMetricDraft(env,owner,prepared)
    return result(request,saved,'/app/metrics/'+key)
   }
   if(action==='run'){exact(data,[]);return result(request,await runMetric(env,owner,ownerId,id),'/app/metrics/'+id)}
   if(action==='deprecate') {
    exact(data,['revision','digest','publishedRevision','reason','confirm'])
    if(request.headers.has('authorization')||data.confirm!=='deprecate')fail('native_owner_confirmation_required',403)
    const row=await metric(env,ownerId,id),rev=(await revision(env,id,row.head_revision))!
    if(row.deprecated_at)fail('metric_deprecated',409)
    if(Number(data.revision)!==row.head_revision||data.digest!==rev.digest||Number(data.publishedRevision)!==row.published_revision)fail('stale_metric_approval',409)
    const now=new Date().toISOString(),reason=text(data.reason,1000)
    await transact(env.DB,owner,[assertion(metricGuard(row)),sql('UPDATE bf_metrics SET deprecated_at=?,deprecated_by=?,deprecated_reason=? WHERE id=?',now,ownerId,reason,id)])
    return result(request,{id,state:'deprecated',deprecatedAt:now,deprecatedBy:ownerId,reason},'/app/metrics/'+id,200)
   }
   if(action==='approve') {
    exact(data,['revision','digest','annotation','confirm'])
    if(request.headers.has('authorization')||data.confirm!=='approve')fail('native_owner_confirmation_required',403)
    const row=await metric(env,ownerId,id),rev=(await revision(env,id,row.head_revision))!
    if(row.deprecated_at)fail('metric_deprecated',409)
    if(Number(data.revision)!==row.head_revision||data.digest!==rev.digest||rev.approved_at)fail('stale_metric_approval',409)
    const evaluation=await metricValue(env,ownerId,row,rev)
    if(evaluation.value.state!=='value')fail('metric_value_unavailable',409)
    const now=new Date().toISOString(),annotation=text(data.annotation,1000)
    await transact(env.DB,owner,[assertion(metricGuard(row)),...evaluation.sources.map(sourceMatch).map(assertion),...(evaluation.context.guards??[]).map(assertion),sql('UPDATE bf_metrics SET published_revision=? WHERE id=?',rev.revision,id),sql('UPDATE bf_metric_revisions SET approved_at=?,annotation=? WHERE metric_id=? AND revision=? AND digest=? AND approved_at IS NULL',now,annotation,id,rev.revision,rev.digest)])
    return result(request,{id,revision:rev.revision,digest:rev.digest,state:'certified',approvedAt:now,annotation},'/app/metrics/'+id,200)
   }
   fail('method_not_allowed',405)
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(!id) {
   if(page)return document('Metrics',viewer,metricsMain(await metricList(env,owner,ownerId)))
   const rows=(await env.DB.prepare('SELECT * FROM bf_metrics WHERE owner_id=? ORDER BY id LIMIT 100').bind(ownerId).all<MetricRow>()).results
   await transact(env.DB,owner,[])
   return json({metrics:rows})
  }
  const view=await metricView(env,owner,ownerId,id)
  if(!page)return json({metric:view.row,revisions:view.revisions.map(r=>({...r,definition:JSON.parse(r.document_json),document_json:undefined})),impact:view.impact})
  return document(view.doc.name,viewer,metricMain(view,owner.email))
 }catch(e){
  const error=e instanceof QueryError?e:new QueryError('metric_conflict',409)
  if(!page&&!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return json({error:error.code},error.status)
  // A refused page or form re-renders the same page with the person's values and a plain sentence; the status stays.
  const refusal=metricRefusal(request.method==='POST'?action??(id?'page':'create'):'page',error.code,data)
  try {
   if(id&&error.code!=='metric_not_found'){const view=await metricView(env,owner,ownerId,id);return document(view.doc.name,viewer,metricMain(view,owner.email,refusal),error.status)}
   return document('Metrics',viewer,metricsMain(await metricList(env,owner,ownerId),refusal),error.status)
  }catch{return document('Metrics',viewer,refusalLine({...refusal,form:'page',field:null},'page')+'<p><a href="/app/metrics">Return to Metrics</a></p>',error.status)}
 }
}

/** The Metrics page's records, each with its head revision's name. */
async function metricList(env:Bindings,owner:NonNullable<Awaited<ReturnType<typeof fileOwner>>>,ownerId:string) {
 const rows=(await env.DB.prepare('SELECT m.*,r.document_json FROM bf_metrics m JOIN bf_metric_revisions r ON r.metric_id=m.id AND r.revision=m.head_revision WHERE m.owner_id=? ORDER BY m.id LIMIT 100').bind(ownerId).all<MetricRow&{document_json:string}>()).results
 await transact(env.DB,owner,[])
 return rows
}

/** One metric with its revisions and the paired before/after impact on dependent content, read under one guard. */
async function metricView(env:Bindings,owner:NonNullable<Awaited<ReturnType<typeof fileOwner>>>,ownerId:string,id:string):Promise<MetricView> {
 const row=await metric(env,ownerId,id),revisions=(await env.DB.prepare('SELECT * FROM bf_metric_revisions WHERE metric_id=? ORDER BY revision DESC').bind(id).all<Revision>()).results
 const dependencies=(await env.DB.prepare(`SELECT u.snapshot_id,u.revision,a.id AS artifact_id,a.kind,a.title FROM bf_metric_uses u LEFT JOIN bf_query_artifacts a ON a.snapshot_id=u.snapshot_id WHERE u.metric_id=? UNION ALL SELECT u.snapshot_id,u.revision,b.id,b.kind,b.title FROM bf_metric_uses u JOIN bf_analytics_cards c ON c.snapshot_id=u.snapshot_id JOIN bf_analytics_boards b ON b.id=c.board_id WHERE u.metric_id=?`).bind(id,id).all()).results
 const goals=(await env.DB.prepare('SELECT g.id,g.version,v.document_json FROM bf_goals g JOIN bf_goal_versions v ON v.goal_id=g.id AND v.version=g.version WHERE g.metric_id=? AND g.owner_id=? ORDER BY g.id').bind(id,ownerId).all<{id:string;version:number;document_json:string}>()).results
 const goalDependencies=goals.map(g=>({artifact_id:g.id,kind:'goal',version:g.version,paired:{state:'unknown',reason:'metric_value_unavailable'} as unknown}))
 dependencies.push(...goalDependencies)
 const head=revisions[0],doc=JSON.parse(head.document_json) as MetricDocument
 let impact:unknown
 const previewGuards=[metricGuard(row)]
 const evaluate=async(rev:Revision)=>{
  const value=await metricValue(env,ownerId,row,rev)
  previewGuards.push(...value.sources.map(sourceMatch),...value.context.guards??[])
  return value
 }
 try{
  const certified=row.published_revision?(await revision(env,id,row.published_revision))!:null
  const next=await evaluate(head),old=certified?await evaluate(certified):null
  for(const goal of goals) {
   const def=JSON.parse(goal.document_json),asOf=new Date().toISOString().slice(0,10)
   previewGuards.push(sql('EXISTS(SELECT 1 FROM bf_goals WHERE id=? AND version=?)',goal.id,goal.version))
   let paired:unknown
   try{
    const previous=certified?await evaluate(goalPeriod(certified,def,asOf).revision):null,next=await evaluate(goalPeriod(head,def,asOf).revision)
    const stale=[...(previous?.sources??[]),...next.sources].some(source=>{const at=Date.parse(source.table.source.lineage?.observedAt??source.table.updatedAt);return !Number.isFinite(at)||at>Date.now()||Date.now()-at>def.maxAgeSeconds*1000})
    paired=stale?{state:'stale',before:null,after:null,reason:'source_freshness'}:{before:previous?.value??null,after:next.value,asOf,from:def.from,to:def.to}
   }
   catch(error){if(!(error instanceof QueryError))throw error;paired={state:'unknown',reason:error.code}}
   goalDependencies.find(d=>d.artifact_id===goal.id)!.paired=paired
  }
  impact={before:old?.value??null,after:next.value,sourceWatermarks:next.answer.sourceWatermarks,lineage:next.sources.map(s=>({dataset:s.id,revision:s.revision,source:s.table.source})),dependencies}
 }
 catch(e){if(!(e instanceof QueryError))throw e;impact={state:'unknown',reason:e.code,dependencies}}
 await transact(env.DB,owner,previewGuards.map(assertion))
 return {row,revisions,head,doc,impact}
}

export async function metricResponse(request:Request,env:Bindings):Promise<Response|null> {
 const response=await handleMetricResponse(request,env)
 return response?rejectedUpload(request,response):null
}
