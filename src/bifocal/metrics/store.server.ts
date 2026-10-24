import { runtimeBindings, operatorAuth, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity, readSources, saveQuery, sourceMatch } from '../data/snapshots/store'
import { queryInput } from '../query/validate'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, QueryError, type Query } from '../query/types'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { details, document, exact, field, hidden, ident, input, json, object, result, text } from './transport'
import { escapeHtml } from '../../app/shell'
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
function definition(v:unknown):MetricDocument {
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
export async function metricResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith('/app/metrics'),match=/^\/(?:api\/operator|app)\/metrics(?:\/([a-z][a-z0-9-]{0,63}))?(?:\/(propose|approve|run|impact|deprecate))?$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return page?new Response('Current installation owner required.',{status:403,headers:{'cache-control':'no-store'}}):json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),viewer=(await operatorAuth(env).getSession(request))!.operator
 try {
  if(url.search)fail('query_parameters_not_supported',400)
  const id=match[1],action=match[2]
  if(request.method==='POST') {
   const data=await input(request)
   if(!id||action==='propose') {
    exact(data,!id?['id','definition']:['previousRevision','definition'])
    const key=id??ident(data.id),old=id?await metric(env,ownerId,id):null
    if(old?.deprecated_at)fail('metric_deprecated',409)
    if(old&&Number(data.previousRevision)!==old.head_revision)fail('stale_metric_revision',409)
    const doc=definition(data.definition),n=(old?.head_revision??0)+1,encoded=canonicalJson(doc),digest=sha256(encoded),now=new Date().toISOString()
    const evaluation=await metricValue(env,ownerId,{id:key,owner_id:ownerId,head_revision:n,published_revision:null,deprecated_at:null,deprecated_by:null,deprecated_reason:null},{metric_id:key,revision:n,dataset_id:doc.query.dataset,document_json:encoded,digest,created_at:now,approved_at:null,annotation:null})
    await transact(env.DB,owner,[...(old?[assertion(metricGuard(old))]:[]),...evaluation.sources.map(sourceMatch).map(assertion),...(evaluation.context.guards??[]).map(assertion),old?sql('UPDATE bf_metrics SET head_revision=? WHERE id=?',n,key):sql('INSERT INTO bf_metrics(id,owner_id,head_revision) VALUES(?,?,?)',key,ownerId,n),sql('INSERT INTO bf_metric_revisions(metric_id,revision,dataset_id,document_json,digest,created_at) VALUES(?,?,?,?,?,?)',key,n,doc.query.dataset,encoded,digest,now)])
    return result(request,{id:key,revision:n,digest,state:'draft'},'/app/metrics/'+key)
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
   const rows=(await env.DB.prepare('SELECT * FROM bf_metrics WHERE owner_id=? ORDER BY id LIMIT 100').bind(ownerId).all<MetricRow>()).results
   await transact(env.DB,owner,[])
   if(!page)return json({metrics:rows})
   return document('Metrics',viewer,`<p>Owner-only definitions with immutable revisions. A draft never changes the certified version. Spreadsheet, agent and portal integration remains unfinished.</p><ul>${rows.map(r=>`<li><a href="/app/metrics/${r.id}">${r.id}</a> · ${r.deprecated_at?'Deprecated':r.published_revision?'Certified revision '+r.published_revision+(r.head_revision!==r.published_revision?' · Draft revision '+r.head_revision:''):'Draft'}</li>`).join('')}</ul><h2>Create a metric</h2><form method="post" action="/api/operator/metrics">${field('id','Stable metric ID')}<label>Metric definition (JSON)<textarea name="definition" rows="12" required></textarea></label><p class="hint">Include name, description, grain, unit, timezone, accountingBasis and one scalar exact query. Use the same conventions as Exact answers.</p><button type="submit">Save draft</button></form>`)
  }
  const row=await metric(env,ownerId,id),revisions=(await env.DB.prepare('SELECT * FROM bf_metric_revisions WHERE metric_id=? ORDER BY revision DESC').bind(id).all<Revision>()).results
  const dependencies=(await env.DB.prepare(`SELECT u.snapshot_id,u.revision,a.id AS artifact_id,a.kind,a.title FROM bf_metric_uses u LEFT JOIN bf_query_artifacts a ON a.snapshot_id=u.snapshot_id WHERE u.metric_id=? UNION ALL SELECT u.snapshot_id,u.revision,b.id,b.kind,b.title FROM bf_metric_uses u JOIN bf_analytics_cards c ON c.snapshot_id=u.snapshot_id JOIN bf_analytics_boards b ON b.id=c.board_id WHERE u.metric_id=?`).bind(id,id).all()).results
  const goals=(await env.DB.prepare('SELECT id,version FROM bf_goals WHERE metric_id=? AND owner_id=? ORDER BY id').bind(id,ownerId).all()).results
  dependencies.push(...goals.map(g=>({artifact_id:g.id,kind:'goal',version:g.version})))
  const head=revisions[0],doc=JSON.parse(head.document_json) as MetricDocument
  let impact:unknown
  try{const next=await metricValue(env,ownerId,row,head),old=row.published_revision?await metricValue(env,ownerId,row,(await revision(env,id,row.published_revision))!):null;impact={before:old?.value??null,after:next.value,sourceWatermarks:next.answer.sourceWatermarks,dependencies}}
  catch(e){if(!(e instanceof QueryError))throw e;impact={state:'unknown',reason:e.code,dependencies}}
  await transact(env.DB,owner,[assertion(metricGuard(row))])
  if(!page)return json({metric:row,revisions:revisions.map(r=>({...r,definition:JSON.parse(r.document_json),document_json:undefined})),impact})
  return document(doc.name,viewer,`<p>${escapeHtml(doc.description)}</p><p class="status">${row.deprecated_at?'Deprecated — unavailable for new use':row.published_revision?'Certified revision '+row.published_revision:'Draft — not certified'} · ${row.head_revision!==row.published_revision?'Draft revision ':'Latest revision '}${row.head_revision}</p><p>Owner: ${escapeHtml(owner.email)}. ${escapeHtml(doc.grain)} · ${escapeHtml(doc.unit)} · ${escapeHtml(doc.timezone)} · ${escapeHtml(doc.accountingBasis)}</p>${details('Change impact and dependent content',impact)}${row.deprecated_at?`<p role="status">Deprecated on ${escapeHtml(row.deprecated_at)}. ${escapeHtml(row.deprecated_reason??'')}</p>`:''}${!row.deprecated_at&&!head.approved_at?`<form method="post" action="/api/operator/metrics/${id}/approve"><h2>Review exact definition</h2>${hidden('revision',head.revision)}${hidden('digest',head.digest)}${details('Definition to approve',doc)}${field('annotation','Dated change annotation')}<label><input type="checkbox" name="confirm" value="approve" required> I approve this exact metric definition</label><button type="submit">Certify revision ${head.revision}</button></form>`:''}${!row.deprecated_at?`<form method="post" action="/api/operator/metrics/${id}/propose"><h2>Propose a change</h2>${hidden('previousRevision',row.head_revision)}<label>Revised metric definition (JSON)<textarea name="definition" rows="10" required>${escapeHtml(head.document_json)}</textarea></label><button type="submit">Save proposed revision</button></form>`:''}${!row.deprecated_at&&row.published_revision?`<form method="post" action="/api/operator/metrics/${id}/deprecate"><h2>Deprecate metric</h2><p>New runs and goal actuals will be unavailable. Retained reports keep their original definitions and values.</p>${hidden('revision',row.head_revision)}${hidden('digest',head.digest)}${hidden('publishedRevision',row.published_revision)}${field('reason','Deprecation reason')}<label><input type="checkbox" name="confirm" value="deprecate" required> I reviewed this definition and its dependent content</label><button type="submit">Deprecate metric</button></form>`:''}${details('Immutable revision history',revisions.map(r=>({revision:r.revision,definition:JSON.parse(r.document_json),digest:r.digest,createdAt:r.created_at,approvedAt:r.approved_at,annotation:r.annotation})))}`)
 }catch(e){const error=e instanceof QueryError?e:new QueryError('metric_conflict',409);return page||request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')?document('Metric unavailable',viewer,`<p role="alert">${escapeHtml(error.code)}</p><a href="/app/metrics">Return to metrics</a>`,error.status):json({error:error.code},error.status)}
}
