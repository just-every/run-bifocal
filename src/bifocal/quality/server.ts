import { rejectedUpload } from '../http/rejected'
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity } from '../data/snapshots/store'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Table } from '../imports/files/csv'
import { fail, QueryError } from '../query/types'
import { randomUUID } from 'node:crypto'
import { sectionDocument, exact, ident, input, json, object, result, text } from '../metrics/transport'
import { refusalLine } from '../metrics/forms'
import { qualityRefusal } from '../metrics/refusals'
import { qualityMain } from './page'
import { sourceImpact } from '../models/lineage/server'
import { evaluate, type RuleDefinition, type SourceRow } from './evaluate'
import { inspectQuality, qualityState } from './evidence.server'
const document = sectionDocument('quality')
type Rule={id:string;owner_id:string;dataset_id:string;rule_json:string}
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
export { qualityState } from './evidence.server'
async function handleQualityResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname==='/app/quality',match=/^\/api\/operator\/quality(?:\/rules(?:\/([a-z][a-z0-9-]{0,63})(?:\/(run))?)?|\/runs\/([a-f0-9-]{36})\/waive|\/impact\/([a-z][a-z0-9-]{0,63}))?$/.exec(url.pathname)
 if(!page&&!match)return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return page?new Response('Current installation owner required.',{status:403,headers:{'cache-control':'no-store'}}):json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),viewer=(await operatorAuth(env).getSession(request))!.operator
 let v:Record<string,unknown>={}
 try {
  if(request.method==='POST') {
   v=await input(request)
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
    const run=await env.DB.prepare('SELECT r.rule_id,r.source_revision,r.result_json,q.dataset_id FROM bf_quality_runs r JOIN bf_quality_rules q ON q.id=r.rule_id WHERE r.id=? AND q.owner_id=?').bind(match[3],ownerId).first<{rule_id:string;source_revision:string|null;result_json:string;dataset_id:string}>()
    if(!run)fail('failed_run_required',409)
    const inspected=await inspectQuality(env,[run.dataset_id],ownerId)
    const current=inspected.quality.tests.find(test=>test.ruleId===run.rule_id&&test.runId===match[3]&&test.sourceRevision===run.source_revision)
    if(JSON.parse(run.result_json).state!=='failed'&&!(current?.state==='failed'&&current.currentEvidence))fail('failed_run_required',409)
    const expiresAt=text(v.expiresAt,40),expiry=Date.parse(expiresAt);if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+2592000000)fail('future_expiry_within_30_days_required',400)
    await transact(env.DB,owner,[...inspected.guards.map(assertion),sql('INSERT INTO bf_quality_waivers(run_id,owner_id,reason,expires_at,created_at) VALUES(?,?,?,?,?)',match[3],ownerId,text(v.reason,1000),new Date(expiry).toISOString(),new Date().toISOString())])
    return result(request,{runId:match[3],expiresAt:new Date(expiry).toISOString()},'/app/quality')
   }
   fail('method_not_allowed',405)
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(match?.[4]) {
   const column=url.searchParams.get('column');if(!column||[...url.searchParams.keys()].some(k=>k!=='column'))fail('source_column_required',400)
   const impact=await sourceImpact(env,match[4],column,ownerId)
   await transact(env.DB,owner,[]);return json(impact)
  }
  if(url.search)fail('query_parameters_not_supported',400)
  const {rules,histories,quality}=await qualityView(env,owner,ownerId)
  if(!page)return json({rules:rules.map(r=>({...r,definition:JSON.parse(r.rule_json),rule_json:undefined})),histories,quality})
  return document('Data quality',viewer,qualityMain(rules,histories,quality))
 }catch(e){
  const error=e instanceof QueryError?e:new QueryError('quality_conflict',409)
  if(!page&&!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return json({error:error.code},error.status)
  // A refused page or form re-renders the same page with the person's values and a plain sentence; the status stays.
  const form=request.method!=='POST'?'page':url.pathname==='/api/operator/quality/rules'?'rule':match?.[2]?'run':match?.[3]?'waive-'+match[3]:'page'
  const refusal=qualityRefusal(form,error.code,v)
  try {
   const {rules,histories,quality}=await qualityView(env,owner,ownerId)
   return document('Data quality',viewer,qualityMain(rules,histories,quality,refusal),error.status)
  }catch{return document('Data quality',viewer,refusalLine({...refusal,form:'page',field:null},'page')+'<p><a href="/app/quality">Return to Data quality</a></p>',error.status)}
 }
}

/** The owner's rules, recent runs and current quality state, read under the owner's authority. */
async function qualityView(env:Bindings,owner:NonNullable<Awaited<ReturnType<typeof fileOwner>>>,ownerId:string) {
 const rules=(await env.DB.prepare('SELECT * FROM bf_quality_rules WHERE owner_id=? ORDER BY id').bind(ownerId).all<Rule>()).results
 const histories=(await env.DB.prepare('SELECT r.* FROM bf_quality_runs r JOIN bf_quality_rules q ON q.id=r.rule_id WHERE q.owner_id=? ORDER BY r.rowid DESC LIMIT 100').bind(ownerId).all<{id:string;rule_id:string;source_revision:string|null;result_json:string;created_at:string}>()).results.map(r=>({...r,result:JSON.parse(String(r.result_json)),result_json:undefined}))
 const quality=await qualityState(env,rules.map(r=>r.dataset_id),ownerId)
 // Keep every linked current run reachable even when newer runs fill the recent list.
 for(const test of quality.tests)if(test.runId&&!histories.some(run=>run.id===test.runId)){
  const run=await env.DB.prepare('SELECT r.* FROM bf_quality_runs r JOIN bf_quality_rules q ON q.id=r.rule_id WHERE r.id=? AND q.owner_id=?').bind(test.runId,ownerId).first<{id:string;rule_id:string;source_revision:string|null;result_json:string;created_at:string}>()
  if(run)histories.push({...run,result:JSON.parse(run.result_json),result_json:undefined})
 }
 await transact(env.DB,owner,[])
 return {rules,histories,quality}
}

export async function qualityResponse(request:Request,env:Bindings):Promise<Response|null> {
 const response=await handleQualityResponse(request,env)
 return response?rejectedUpload(request,response):null
}
