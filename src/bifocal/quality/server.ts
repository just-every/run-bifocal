import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity } from '../data/snapshots/store'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { decimal, plus, rational } from '../currency/decimal'
import type { Table } from '../imports/files/csv'
import { fail, QueryError } from '../query/types'
import { randomUUID } from 'node:crypto'
import { escapeHtml } from '../../app/shell'
import { details, document, exact, field, hidden, ident, input, json, object, result, text } from '../metrics/transport'
import { sourceImpact } from '../models/lineage/server'
type Rule={id:string;owner_id:string;dataset_id:string;rule_json:string}
type RuleDefinition={name:string;kind:'freshness'|'not-null'|'unique'|'accepted-values'|'count'|'money';column?:string;maxAgeSeconds?:number;values?:unknown[];expected?:string}
type SourceRow={revision:string;value_json:string}
function parse(v:unknown):RuleDefinition {
 if(typeof v==='string'){try{v=JSON.parse(v)}catch{fail('invalid_rule',400)}}
 if(!object(v))fail('rule_required',400)
 exact(v,['name','kind','column','maxAgeSeconds','values','expected']);text(v.name,160)
 if(!['freshness','not-null','unique','accepted-values','count','money'].includes(String(v.kind)))fail('invalid_rule_kind',400)
 if(['not-null','unique','accepted-values','money'].includes(String(v.kind)))text(v.column,200)
 if(v.kind==='freshness'&&(!Number.isSafeInteger(v.maxAgeSeconds)||Number(v.maxAgeSeconds)<1||Number(v.maxAgeSeconds)>2592000))fail('freshness_limit_required',400)
 if(v.kind==='accepted-values'&&(!Array.isArray(v.values)||!v.values.length||v.values.length>100||v.values.some(x=>x!==null&&typeof x!=='boolean'&&!(typeof x==='string'&&x.length<=4096))))fail('accepted_values_required',400)
 if(v.kind==='count'&&!(typeof v.expected==='string'&&/^\d{1,8}$/.test(v.expected)))fail('count_required',400)
 if(v.kind==='money'&&!(typeof v.expected==='string'&&/^-?\d{1,24}\.\d{2}$/.test(v.expected)))fail('money_required',400)
 return v as unknown as RuleDefinition
}
export function evaluate(rule:RuleDefinition,source:SourceRow|null,now=Date.now()) {
 if(!source)return {state:'unknown',reason:'source_unavailable',failingRowNumbers:[]}
 const table=JSON.parse(source.value_json) as Table,index=table.columns.findIndex(c=>c.name===rule.column),failures:number[]=[]
 if(rule.column&&index<0)return {state:'unknown',reason:'column_unavailable',failingRowNumbers:[]}
 if(rule.kind==='freshness') {
  const at=Date.parse(table.source.lineage?.observedAt??table.updatedAt)
  return {state:!Number.isFinite(at)||at>now?'unknown':now-at>rule.maxAgeSeconds!*1000?'failed':'passed',reason:'source_freshness',observedAt:Number.isFinite(at)?new Date(at).toISOString():null,failingRowNumbers:[]}
 }
 if(rule.kind==='count')return {state:String(table.rows.length)===rule.expected?'passed':'failed',reason:'row_count',actual:String(table.rows.length),expected:rule.expected,failingRowNumbers:[]}
 if(rule.kind==='money') {
  if(table.columns[index].type!=='money')return {state:'unknown',reason:'money_column_required',failingRowNumbers:[]}
  let total=rational(0n)
  for(const [i,row] of table.rows.entries()){if(row[index]===null)failures.push(i+1);else total=plus(total,decimal(row[index]))}
  const expected=decimal(rule.expected),matches=total.numerator*expected.denominator===expected.numerator*total.denominator
  return {state:!failures.length&&matches?'passed':'failed',reason:'exact_money_reconciliation',expected:rule.expected,actual:{numerator:String(total.numerator),denominator:String(total.denominator)},failingRowNumbers:failures.slice(0,20),failureCount:failures.length}
 }
 const seen=new Set<string>()
 for(const [i,row] of table.rows.entries()) {
  const value=row[index],key=canonicalJson(value)
  if(rule.kind==='not-null'&&value===null||rule.kind==='unique'&&(value===null||seen.has(key))||rule.kind==='accepted-values'&&!rule.values!.some(v=>canonicalJson(v)===key))failures.push(i+1)
  seen.add(key)
 }
 return {state:failures.length?'failed':'passed',reason:rule.kind,failureCount:failures.length,failingRowNumbers:failures.slice(0,20)}
}
export async function qualityState(env:Bindings,datasets:string[]) {
 const tests:Record<string,unknown>[]=[]
 for(const dataset of [...new Set(datasets)]) {
  const source=await env.DB.prepare('SELECT revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<SourceRow>()
  const rules=(await env.DB.prepare('SELECT * FROM bf_quality_rules WHERE dataset_id=?').bind(dataset).all<Rule>()).results
  if(!source||!rules.length){tests.push({dataset,state:'unknown',reason:!source?'source_unavailable':'no_quality_evidence'});continue}
  for(const rule of rules) {
   const run=await env.DB.prepare('SELECT * FROM bf_quality_runs WHERE rule_id=? ORDER BY rowid DESC LIMIT 1').bind(rule.id).first<{id:string;source_revision:string;result_json:string}>(),def=JSON.parse(rule.rule_json) as RuleDefinition
   const saved=run?JSON.parse(run.result_json):{state:'unknown',reason:'not_run'}
   let state=run&&run.source_revision===source.revision?saved.state:'unknown',reason=state==='unknown'?'source_changed_or_unchecked':saved.reason
   if(def.kind==='freshness'&&state==='passed'){const live=evaluate(def,source);state=live.state;reason=live.reason}
   const waiver=run?await env.DB.prepare('SELECT reason,expires_at FROM bf_quality_waivers WHERE run_id=?').bind(run.id).first<{reason:string;expires_at:string}>():null
   tests.push({dataset,ruleId:rule.id,name:def.name,runId:run?.id??null,state,reason,waiver:waiver?{...waiver,active:Date.parse(waiver.expires_at)>Date.now()}:null})
  }
 }
 return {state:tests.some(t=>t.state==='failed')?'at risk':!tests.length||tests.some(t=>t.state==='unknown')?'unknown':'healthy',tests}
}
export async function qualityResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname==='/app/quality',match=/^\/api\/operator\/quality(?:\/rules(?:\/([a-z][a-z0-9-]{0,63})(?:\/(run))?)?|\/runs\/([a-f0-9-]{36})\/waive|\/impact\/([a-z][a-z0-9-]{0,63}))?$/.exec(url.pathname)
 if(!page&&!match)return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return page?new Response('Current installation owner required.',{status:403,headers:{'cache-control':'no-store'}}):json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),viewer=(await operatorAuth(env).getSession(request))!.operator
 try {
  if(request.method==='POST') {
   const v=await input(request)
   if(url.pathname==='/api/operator/quality/rules') {
    exact(v,['id','dataset','definition']);const id=ident(v.id),dataset=ident(v.dataset),def=parse(v.definition)
    const source=await env.DB.prepare('SELECT revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<SourceRow>();if(!source)fail('dataset_not_found',404)
    if(def.column&&!(JSON.parse(source.value_json) as Table).columns.some(c=>c.name===def.column))fail('column_not_found',400)
    await transact(env.DB,owner,[assertion(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=?)',dataset,source.revision)),sql('INSERT INTO bf_quality_rules(id,owner_id,dataset_id,rule_json) VALUES(?,?,?,?)',id,ownerId,dataset,canonicalJson(def))])
    return result(request,{id,dataset,definition:def},'/app/quality')
   }
   if(match?.[1]&&match[2]) {
    exact(v,[])
    const rule=await env.DB.prepare('SELECT * FROM bf_quality_rules WHERE id=? AND owner_id=?').bind(match[1],ownerId).first<Rule>();if(!rule)fail('rule_not_found',404)
    const source=await env.DB.prepare('SELECT revision,value_json FROM bf_file_tables WHERE id=?').bind(rule.dataset_id).first<SourceRow>(),outcome=evaluate(JSON.parse(rule.rule_json),source),id=randomUUID(),now=new Date().toISOString()
    await transact(env.DB,owner,[assertion(sql('EXISTS(SELECT 1 FROM bf_quality_rules WHERE id=? AND rule_json=?)',rule.id,rule.rule_json)),assertion(source?sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=? AND value_json=?)',rule.dataset_id,source.revision,source.value_json):sql('NOT EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?)',rule.dataset_id)),sql('INSERT INTO bf_quality_runs(id,rule_id,source_revision,result_json,created_at) VALUES(?,?,?,?,?)',id,rule.id,source?.revision??null,canonicalJson(outcome),now)])
    return result(request,{id,ruleId:rule.id,sourceRevision:source?.revision??null,result:outcome,createdAt:now},'/app/quality')
   }
   if(match?.[3]) {
    exact(v,['reason','expiresAt','confirm']);if(v.confirm!=='waive')fail('owner_waiver_confirmation_required',400)
    const run=await env.DB.prepare('SELECT r.result_json FROM bf_quality_runs r JOIN bf_quality_rules q ON q.id=r.rule_id WHERE r.id=? AND q.owner_id=?').bind(match[3],ownerId).first<{result_json:string}>()
    if(!run||JSON.parse(run.result_json).state!=='failed')fail('failed_run_required',409)
    const expiresAt=text(v.expiresAt,40),expiry=Date.parse(expiresAt);if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+2592000000)fail('future_expiry_within_30_days_required',400)
    await transact(env.DB,owner,[sql('INSERT INTO bf_quality_waivers(run_id,owner_id,reason,expires_at,created_at) VALUES(?,?,?,?,?)',match[3],ownerId,text(v.reason,1000),new Date(expiry).toISOString(),new Date().toISOString())])
    return result(request,{runId:match[3],expiresAt:new Date(expiry).toISOString()},'/app/quality')
   }
   fail('method_not_allowed',405)
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(match?.[4]) {
   const column=url.searchParams.get('column');if(!column||[...url.searchParams.keys()].some(k=>k!=='column'))fail('source_column_required',400)
   const impact=await sourceImpact(env,match[4],column)
   await transact(env.DB,owner,[]);return json(impact)
  }
  if(url.search)fail('query_parameters_not_supported',400)
  const rules=(await env.DB.prepare('SELECT * FROM bf_quality_rules WHERE owner_id=? ORDER BY id').bind(ownerId).all<Rule>()).results
  const histories=(await env.DB.prepare('SELECT r.* FROM bf_quality_runs r JOIN bf_quality_rules q ON q.id=r.rule_id WHERE q.owner_id=? ORDER BY r.rowid DESC LIMIT 100').bind(ownerId).all<{id:string;rule_id:string;source_revision:string|null;result_json:string;created_at:string}>()).results.map(r=>({...r,result:JSON.parse(String(r.result_json)),result_json:undefined}))
  const quality=await qualityState(env,rules.map(r=>r.dataset_id))
  await transact(env.DB,owner,[])
  if(!page)return json({rules:rules.map(r=>({...r,definition:JSON.parse(r.rule_json),rule_json:undefined})),histories,quality})
  return document('Data quality',viewer,`<p>Run bounded source checks synchronously. A waiver records an exception; it never turns a failure into healthy data. No background analytical job is claimed.</p><p class="status">${escapeHtml(quality.state)}</p>${details('Current tests and expiry',quality)}${rules.map(r=>`<section class="panel"><h2>${escapeHtml((JSON.parse(r.rule_json) as RuleDefinition).name)}</h2><p>${r.dataset_id} · ${r.id}</p><form method="post" action="/api/operator/quality/rules/${r.id}/run"><button type="submit">Run ${escapeHtml(r.id)}</button></form></section>`).join('')}<h2>Add a quality rule</h2><form method="post" action="/api/operator/quality/rules">${field('id','Rule ID')}${field('dataset','Dataset ID')}<label>Rule definition (JSON)<textarea name="definition" rows="6" required></textarea></label><p class="hint">Kinds: freshness, not-null, unique, accepted-values, count, money. Supply a name and the relevant column, expected value, accepted values or maximum age in seconds.</p><button type="submit">Save rule</button></form>${details('Run history with source revision and failing row numbers',histories)}${histories.filter(r=>r.result.state==='failed').map(r=>`<form class="panel" method="post" action="/api/operator/quality/runs/${r.id}/waive"><h2>Review waiver for ${r.id}</h2>${field('reason','Exception reason')}${field('expiresAt','Expiry (ISO timestamp)')}${hidden('confirm','waive')}<button type="submit">Record expiring waiver</button></form>`).join('')}`)
 }catch(e){const error=e instanceof QueryError?e:new QueryError('quality_conflict',409);return page||request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')?document('Quality check unavailable',viewer,`<p role="alert">${escapeHtml(error.code)}</p><a href="/app/quality">Return to data quality</a>`,error.status):json({error:error.code},error.status)}
}
