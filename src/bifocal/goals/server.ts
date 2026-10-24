import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity, sourceMatch } from '../data/snapshots/store'
import { metric, revision, metricGuard, metricValue, type MetricDocument } from '../metrics/store.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail, QueryError } from '../query/types'
import { easelTarget } from './easel'
import { goalPeriod } from './period'
import { randomUUID } from 'node:crypto'
import { escapeHtml } from '../../app/shell'
import { details, document, exact, field, hidden, ident, input, json, result, text } from '../metrics/transport'
type Goal={id:string;owner_id:string;metric_id:string;version:number}
type GoalDefinition={title:string;from:string;to:string;dateColumn:string;target:string;currency:'USD';maxAgeSeconds:number;easel?:NonNullable<Awaited<ReturnType<typeof easelTarget>>>['provenance']}
function date(v:unknown):string {const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)fail('valid_date_required',400);return s}
function definition(v:Record<string,unknown>):GoalDefinition {
 const from=date(v.from),to=date(v.to),target=text(v.target,24),maxAgeSeconds=Number(v.maxAgeSeconds)
 if(from>=to||(Date.parse(to)-Date.parse(from))/86400000>366||!/^\d{1,16}\.\d{2}$/.test(target)||BigInt(target.replace('.',''))<=0n||!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1||maxAgeSeconds>2592000||v.currency!=='USD')fail('goal_requires_USD_target_period_and_freshness',400)
 return {title:text(v.title,160),from,to,dateColumn:text(v.dateColumn,200),target,currency:'USD',maxAgeSeconds}
}
const goalGuard=(g:Goal)=>sql('EXISTS(SELECT 1 FROM bf_goals WHERE id=? AND owner_id=? AND version=?)',g.id,g.owner_id,g.version)
export async function goalResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith('/app/goals'),match=/^\/(?:api\/operator|app)\/goals(?:\/([a-z][a-z0-9-]{0,63}))?(?:\/(revise|checkins))?$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return page?new Response('Current installation owner required.',{status:403,headers:{'cache-control':'no-store'}}):json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),viewer=(await operatorAuth(env).getSession(request))!.operator
 try {
  if(url.search)fail('query_parameters_not_supported',400)
  const id=match[1],action=match[2]
  const goal=id?await env.DB.prepare('SELECT * FROM bf_goals WHERE id=? AND owner_id=?').bind(id,ownerId).first<Goal>():null
  if(id&&!goal)fail('goal_not_found',404)
  if(request.method==='POST') {
   const v=await input(request)
   if(action==='checkins'&&goal) {
    exact(v,['observation','observedOn','previousVersion']);if(Number(v.previousVersion)!==goal.version)fail('stale_goal_version',409)
    const checkin={id:randomUUID(),ownerId,observation:text(v.observation,1000),observedOn:date(v.observedOn),createdAt:new Date().toISOString()}
    await transact(env.DB,owner,[assertion(goalGuard(goal)),sql('INSERT INTO bf_goal_checkins(id,goal_id,owner_id,observation,observed_on,created_at) VALUES(?,?,?,?,?,?)',checkin.id,goal.id,ownerId,checkin.observation,checkin.observedOn,checkin.createdAt)])
    return result(request,checkin,'/app/goals/'+id)
   }
   if(!id||action==='revise') {
    exact(v,['id','metricId','previousVersion','title','from','to','dateColumn','target','currency','maxAgeSeconds','easelDataset','easelRevision','easelRow','easelSeries'])
    const key=id??ident(v.id),metricId=goal?.metric_id??ident(v.metricId),m=await metric(env,ownerId,metricId)
    if(!m.published_revision)fail('certified_metric_required',409)
    const rev=(await revision(env,metricId,m.published_revision))!,doc=JSON.parse(rev.document_json) as MetricDocument,def=definition(v)
    if(doc.unit!=='money'||doc.query.measures[0].sourceCurrency!=='USD'||doc.query.measures[0].scale!==2)fail('certified_USD_metric_required',400)
    const evaluation=await metricValue(env,ownerId,m,rev)
    if(!evaluation.sources[0].table.columns.some(c=>c.name===def.dateColumn&&c.type==='date'))fail('date_column_required',400)
    if(goal&&(Number(v.previousVersion)!==goal.version||v.metricId!==undefined&&v.metricId!==goal.metric_id))fail('stale_goal_version',409)
    const imported=await easelTarget(env,v,def)
    if(imported)def.easel=imported.provenance
    const n=(goal?.version??0)+1
    await transact(env.DB,owner,[assertion(metricGuard(m)),...evaluation.sources.map(sourceMatch).map(assertion),...(imported?[assertion(imported.guard)]:[]),...(goal?[assertion(goalGuard(goal)),sql('UPDATE bf_goals SET version=? WHERE id=?',n,key)]:[sql('INSERT INTO bf_goals(id,owner_id,metric_id,version) VALUES(?,?,?,?)',key,ownerId,metricId,n)]),sql('INSERT INTO bf_goal_versions(goal_id,version,document_json,created_at) VALUES(?,?,?,?)',key,n,canonicalJson(def),new Date().toISOString())])
    return result(request,{id:key,metricId,version:n,definition:def},'/app/goals/'+key)
   }
   fail('method_not_allowed',405)
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(!goal) {
   const goals=(await env.DB.prepare('SELECT * FROM bf_goals WHERE owner_id=? ORDER BY id LIMIT 100').bind(ownerId).all()).results
   await transact(env.DB,owner,[])
   if(!page)return json({goals})
   return document('Goals',viewer,`<p>Versioned light targets over certified USD metrics. Enter targets here or import a named Easel plan series from a reviewed CSV dataset. The original export digest records its snapshot; no financial planning is performed here.</p><ul>${goals.map(g=>`<li><a href="/app/goals/${g.id}">${g.id}</a></li>`).join('')}</ul><h2>Create a revenue goal</h2><form method="post" action="/api/operator/goals">${field('id','Goal ID')}${field('metricId','Certified metric ID')}${goalFields()}<button type="submit">Save goal</button></form>`)
  }
  const versions=(await env.DB.prepare('SELECT * FROM bf_goal_versions WHERE goal_id=? ORDER BY version DESC').bind(goal.id).all<{version:number;document_json:string;created_at:string}>()).results,def=JSON.parse(versions[0].document_json) as GoalDefinition
  const checkins=(await env.DB.prepare('SELECT * FROM bf_goal_checkins WHERE goal_id=? ORDER BY observed_on DESC,created_at DESC').bind(goal.id).all()).results
  let actual:Record<string,unknown>={state:'unknown',status:'unknown',forecast:null,reason:'Actuals unavailable'}
  try {
   const m=await metric(env,ownerId,goal.metric_id);if(!m.published_revision)fail('metric_not_certified',409)
   const rev=(await revision(env,m.id,m.published_revision))!,doc=JSON.parse(rev.document_json) as MetricDocument,now=Date.now(),asOf=new Date(now).toISOString().slice(0,10)
   if(doc.unit!=='money'||doc.query.measures[0].sourceCurrency!=='USD'||doc.query.measures[0].scale!==2)fail('metric_unit_changed',409)
   const period=goalPeriod(rev,def,asOf),cutoff=period.cutoff
   const evaluation=await metricValue(env,ownerId,m,period.revision)
   const observedAt=evaluation.sources[0].table.source.lineage?.observedAt??evaluation.sources[0].table.updatedAt
   if(!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>now||now-Date.parse(observedAt)>def.maxAgeSeconds*1000)actual={state:'stale',status:'unknown',forecast:null,reason:'The source exceeds this goal’s freshness limit.',lastObservedAt:observedAt}
   else if(evaluation.value.state==='value') {
    const cents=BigInt(evaluation.value.value!.replace('.','')),target=BigInt(def.target.replace('.','')),elapsed=BigInt(Math.round((Date.parse(cutoff)-Date.parse(def.from))/86400000)),days=BigInt(Math.round((Date.parse(def.to)-Date.parse(def.from))/86400000))
    const projected=cents * days / elapsed,decimal=(v:bigint)=>`${v<0n?'-':''}${(v<0n?-v:v)/100n}.${String((v<0n?-v:v)%100n).padStart(2,'0')}`
    actual={state:'value',status:cents>=target?'target reached':cents*days>=target*elapsed?'on pace':'behind pace',value:evaluation.value,forecast:{kind:'linear pace, not a financial forecast',value:decimal(projected)},asOf,query:evaluation.query,metric:{id:m.id,revision:rev.revision,digest:rev.digest},sourceWatermarks:evaluation.answer.sourceWatermarks}
   }
   await transact(env.DB,owner,[assertion(metricGuard(m)),...evaluation.sources.map(sourceMatch).map(assertion)])
  }catch(e){if(!(e instanceof QueryError))throw e;actual={state:'unknown',status:'unknown',forecast:null,reason:e.code}}
  await transact(env.DB,owner,[assertion(goalGuard(goal))])
  const value={goal,definition:def,versions:versions.map(v=>({...v,definition:JSON.parse(v.document_json),document_json:undefined})),checkins,actual,easel:def.easel?{state:'imported-export',...def.easel}:{state:'unresolved',reason:'No Easel export is attached to this target version.'}}
  if(!page)return json(value)
  return document(def.title,viewer,`<p>Target ${escapeHtml(def.target)} USD · ${def.from} to ${def.to} (exclusive) · Target version ${goal.version}</p><p class="status">Actuals: ${escapeHtml(String(actual.state))} · ${escapeHtml(String(actual.status))}</p>${details('Actual query, source freshness and pace',actual)}<p>${def.easel?`<a href="${escapeHtml(def.easel.link)}" rel="noreferrer">Easel plan dataset</a> · ${escapeHtml(def.easel.series)}.`:'Easel plan: not attached to this target version.'} Target history is preserved when actuals are unavailable. Check-ins are observations; they do not change actuals.</p>${def.easel?details('Easel export provenance',def.easel):''}<h2>Owner check-in</h2><form method="post" action="/api/operator/goals/${goal.id}/checkins">${hidden('previousVersion',goal.version)}${field('observedOn','Observation date','','date')}${field('observation','Observation')}<button type="submit">Add check-in</button></form>${details('Attributed check-ins',checkins)}<h2>Change target or period</h2><form method="post" action="/api/operator/goals/${goal.id}/revise">${hidden('previousVersion',goal.version)}${goalFields(def)}<button type="submit">Save target revision</button></form>${details('Target versions',value.versions)}`)
 }catch(e){const error=e instanceof QueryError?e:new QueryError('goal_conflict',409);return page||request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')?document('Goal unavailable',viewer,`<p role="alert">${escapeHtml(error.code)}</p><a href="/app/goals">Return to goals</a>`,error.status):json({error:error.code},error.status)}
}
function goalFields(v?:GoalDefinition){return field('title','Title',v?.title)+field('from','Period start',v?.from,'date')+field('to','Period end (exclusive)',v?.to,'date')+field('dateColumn','Actuals date column',v?.dateColumn)+field('target','Target (USD, two decimal places)',v?.target)+hidden('currency','USD')+field('maxAgeSeconds','Maximum source age in seconds',String(v?.maxAgeSeconds??86400),'number')+easelFields()}
function easelFields(){return `<details><summary>Use an Easel target export</summary><p>First review and apply the original Easel dataset CSV at <a href="/app/import">Files</a>, selecting its source kind and dataset URL. Enter its current dataset revision, exact row ID and plan series. Enter the reviewed sum in Target. Only complete USD month periods are accepted. Changing this target manually creates a separate version without Easel provenance.</p>${[['easelDataset','Easel dataset ID'],['easelRevision','Reviewed dataset revision'],['easelRow','Easel row ID'],['easelSeries','Easel plan series']].map(([name,label])=>`<label>${label}<input name="${name}"></label>`).join('')}</details>`}
