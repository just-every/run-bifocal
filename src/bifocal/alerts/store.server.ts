import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { readQuery, readSources, sourceMatch } from '../data/snapshots/store'
import { evaluate as evaluateQuality } from '../quality/server'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, type Source } from '../query/types'
import { definition, type AlertDefinition, type AlertRule, type AlertRefs, type Observation, type Episode, type Transition, type Evaluation } from './protocol'
import { qualifies, resultHash } from './predicates'

export type Authority=D1Sql&{email:string}
export type RuleRow={id:string;owner_id:string;query_id:string;definition_json:string;generation:number;baseline_observation_id:string|null;last_observation_id:string|null;qualifying:number;created_at:string}
export const ruleDocument=(row:RuleRow):AlertRule=>({...JSON.parse(row.definition_json) as AlertDefinition,id:row.id,generation:row.generation,baselineObservationId:row.baseline_observation_id,lastObservationId:row.last_observation_id,qualifying:!!row.qualifying,createdAt:row.created_at})
export const ruleGuard=(r:RuleRow)=>sql('EXISTS(SELECT 1 FROM bf_alert_rules WHERE id=? AND owner_id=? AND query_id=? AND definition_json=? AND generation=? AND baseline_observation_id IS ? AND last_observation_id IS ? AND qualifying=?)',r.id,r.owner_id,r.query_id,r.definition_json,r.generation,r.baseline_observation_id,r.last_observation_id,r.qualifying)
export async function readRule(env:Bindings,ownerId:string,id:string):Promise<RuleRow> {
 const r=await env.DB.prepare('SELECT * FROM bf_alert_rules WHERE id=? AND owner_id=?').bind(id,ownerId).first<RuleRow>()
 if(!r)fail('alert_not_found',404)
 return r
}
export async function alertList(env:Bindings,authority:Authority,ownerId:string) {
 const rows=(await env.DB.prepare('SELECT * FROM bf_alert_rules WHERE owner_id=? ORDER BY created_at DESC,id').bind(ownerId).all<RuleRow>()).results
 await transact(env.DB,authority,rows.map(ruleGuard).map(assertion))
 return rows.map(ruleDocument)
}
export async function alertView(env:Bindings,authority:Authority,ownerId:string,id:string) {
 const row=await readRule(env,ownerId,id)
 const observations=(await env.DB.prepare('SELECT payload_json FROM bf_alert_observations WHERE rule_id=? ORDER BY generation DESC').bind(id).all<{payload_json:string}>()).results.map(r=>(JSON.parse(r.payload_json) as Evaluation).observation)
 const episodes=(await env.DB.prepare('SELECT document_json FROM bf_alert_episodes WHERE rule_id=? ORDER BY rowid').bind(id).all<{document_json:string}>()).results.map(r=>JSON.parse(r.document_json) as Episode)
 const transitions=(await env.DB.prepare('SELECT document_json FROM bf_alert_transitions WHERE rule_id=? ORDER BY rowid').bind(id).all<{document_json:string}>()).results.map(r=>JSON.parse(r.document_json) as Transition)
 await transact(env.DB,authority,[assertion(ruleGuard(row))])
 return {rule:ruleDocument(row),observations,episodes,transitions}
}
async function template(env:Bindings,authority:Authority,ownerId:string,id:string) {
 const t=await readQuery(env,authority,ownerId,id)
 if(t.snapshot.context.securityScope.kind!=='installation-owner')fail('alert_owner_scope_required',403)
 return {...t,guards:[t.guard,...t.sources.map(s=>sql('EXISTS(SELECT 1 FROM bf_query_sources WHERE snapshot_id=? AND dataset_id=? AND revision=? AND value_json=?)',id,s.id,s.revision,s.value_json))]}
}
export async function createAlert(env:Bindings,authority:Authority,ownerId:string,v:Record<string,unknown>) {
 if(typeof v.queryId!=='string')fail('query_id_required',400)
 const t=await template(env,authority,ownerId,v.queryId),doc=definition(v,t.snapshot.definition),sources=await readSources(env,t.snapshot.definition),id=randomUUID(),createdAt=new Date().toISOString()
 const row:RuleRow={id,owner_id:ownerId,query_id:doc.queryId,definition_json:canonicalJson(doc),generation:0,baseline_observation_id:null,last_observation_id:null,qualifying:0,created_at:createdAt}
 await transact(env.DB,authority,[...t.guards.map(assertion),...sources.map(sourceMatch).map(assertion),sql('INSERT INTO bf_alert_rules(id,owner_id,query_id,definition_json,created_at) VALUES(?,?,?,?,?)',id,ownerId,doc.queryId,row.definition_json,createdAt),...sources.map(s=>sql('INSERT INTO bf_alert_sources(rule_id,dataset_id) VALUES(?,?)',id,s.id))])
 return ruleDocument(row)
}

/** All configured checks need a current passing run. A waiver never promotes failed evidence. */
async function healthyQuality(env:Bindings,ownerId:string,sources:Source[]) {
 const guards:D1Sql[]=[],evidence:unknown[]=[]
 for(const source of sources) {
  const settled=sql('NOT EXISTS(SELECT 1 FROM ik_door_namespaces WHERE namespace=? AND pending_id IS NOT NULL)',`files:${source.id}`)
  const pending=await env.DB.prepare(`SELECT CASE WHEN (${settled.sql}) THEN 0 ELSE 1 END AS pending`).bind(...settled.params??[]).first<{pending:number}>()
  if(pending?.pending!==0)fail('alert_source_refresh_pending',409)
  guards.push(settled)
  const rules=(await env.DB.prepare('SELECT id,owner_id,rule_json FROM bf_quality_rules WHERE dataset_id=? ORDER BY id').bind(source.id).all<{id:string;owner_id:string;rule_json:string}>()).results
  if(!rules.length)fail('alert_quality_unhealthy',409)
  guards.push(sql('(SELECT count(*) FROM bf_quality_rules WHERE dataset_id=?)=?',source.id,rules.length))
  for(const rule of rules) {
   const run=await env.DB.prepare('SELECT id,source_revision,result_json,created_at FROM bf_quality_runs WHERE rule_id=? ORDER BY rowid DESC LIMIT 1').bind(rule.id).first<{id:string;source_revision:string|null;result_json:string;created_at:string}>()
   const def=JSON.parse(rule.rule_json) as Parameters<typeof evaluateQuality>[0],live=evaluateQuality(def,source),saved=run?JSON.parse(run.result_json):null
   if(rule.owner_id!==ownerId||!run||run.source_revision!==source.revision||saved?.state!=='passed'||live.state!=='passed')fail('alert_quality_unhealthy',409)
   guards.push(sql('EXISTS(SELECT 1 FROM bf_quality_rules WHERE id=? AND owner_id=? AND dataset_id=? AND rule_json=?)',rule.id,ownerId,source.id,rule.rule_json),sql('EXISTS(SELECT 1 FROM bf_quality_runs WHERE id=? AND rule_id=? AND source_revision=? AND result_json=? AND created_at=?) AND (SELECT id FROM bf_quality_runs WHERE rule_id=? ORDER BY rowid DESC LIMIT 1)=?',run.id,rule.id,run.source_revision,run.result_json,run.created_at,rule.id,run.id))
   if(def.kind==='freshness') {
    const observed=source.table.source.lineage?.observedAt??source.table.updatedAt
    guards.push(sql("julianday('now') BETWEEN julianday(?) AND julianday(?)+?/86400.0",observed,observed,def.maxAgeSeconds))
   }
   evidence.push({dataset:source.id,sourceRevision:source.revision,ruleId:rule.id,definition:def,runId:run.id,result:saved,live,createdAt:run.created_at})
  }
 }
 return {guards,evidence}
}
async function currentInputs(env:Bindings,authority:Authority,ownerId:string,row:RuleRow) {
 const t=await template(env,authority,ownerId,row.query_id),sources=await readSources(env,t.snapshot.definition),context=await queryContext(env,t.snapshot.definition,ownerId),quality=await healthyQuality(env,ownerId,sources)
 if(context.currency!==t.snapshot.context.currency)fail('alert_query_currency_changed',409)
 return {t,sources,context,quality,guards:[...t.guards,...sources.map(sourceMatch),...(context.guards??[]),...quality.guards]}
}
const observationGuard=(e:Evaluation)=>sql('EXISTS(SELECT 1 FROM bf_alert_observations WHERE id=? AND rule_id=? AND request_id=? AND payload_json=?)',e.observation.id,e.observation.ruleId,e.observation.requestId,canonicalJson(e))
const openEpisode=async(env:Bindings,ruleId:string)=>{
 const row=await env.DB.prepare("SELECT document_json FROM bf_alert_episodes WHERE rule_id=? AND state='open'").bind(ruleId).first<{document_json:string}>()
 return row?JSON.parse(row.document_json) as Episode:null
}
const saveEpisode=(e:Episode)=>sql('INSERT INTO bf_alert_episodes(id,rule_id,state,document_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,document_json=excluded.document_json',e.id,e.ruleId,e.state,canonicalJson(e))
function transition(row:RuleRow,actorId:string,kind:Transition['kind'],episode:Episode|null,observation:Observation|null,now:string,until:string|null=null):Transition {
 return {id:randomUUID(),ruleId:row.id,episodeId:episode?.id??null,observationId:observation?.id??null,kind,refs:observation?.refs??null,createdAt:now,actorId,until}
}
const saveTransition=(t:Transition)=>sql('INSERT INTO bf_alert_transitions(id,rule_id,episode_id,observation_id,document_json,created_at) VALUES(?,?,?,?,?,?)',t.id,t.ruleId,t.episodeId,t.observationId,canonicalJson(t),t.createdAt)
export async function priorEvaluation(env:Bindings,ruleId:string,requestId:string) {
 const row=await env.DB.prepare('SELECT payload_json FROM bf_alert_observations WHERE rule_id=? AND request_id=?').bind(ruleId,requestId).first<{payload_json:string}>()
 return row?JSON.parse(row.payload_json) as Evaluation:null
}
async function replayEvaluation(env:Bindings,authority:Authority,ownerId:string,id:string,guards:D1Sql[],evaluation:Evaluation) {
 const current=await readRule(env,ownerId,id)
 await transact(env.DB,authority,[assertion(ruleGuard(current)),...guards.map(assertion),assertion(observationGuard(evaluation))])
 return evaluation
}
export async function evaluateAlert(env:Bindings,authority:Authority,ownerId:string,id:string,requestId:string):Promise<Evaluation> {
 const row=await readRule(env,ownerId,id),{t,sources,context,quality,guards}=await currentInputs(env,authority,ownerId,row),duplicate=await priorEvaluation(env,id,requestId)
 if(duplicate)return replayEvaluation(env,authority,ownerId,id,guards,duplicate)
 const doc=ruleDocument(row)
 const answer=execute(t.snapshot.definition,sources,context),hash=resultHash(answer,t.snapshot.definition,sources,doc.comparison)
 const previous=row.last_observation_id?await env.DB.prepare('SELECT payload_json FROM bf_alert_observations WHERE id=? AND rule_id=?').bind(row.last_observation_id,id).first<{payload_json:string}>():null
 if(row.last_observation_id&&!previous)fail('alert_baseline_unavailable',409)
 const baseline=!row.baseline_observation_id,prior=previous?(JSON.parse(previous.payload_json) as Evaluation).observation:null,condition=qualifies(doc.predicate,answer,hash,prior?.resultHash??hash),qualifying=!baseline&&condition
 let episode=await openEpisode(env,id)
 const now=new Date().toISOString(),snoozed=!!episode?.snoozedUntil&&Date.parse(episode.snoozedUntil)>Date.parse(now),triggered=qualifying&&!snoozed&&(doc.behavior==='every'||!row.qualifying),{guards:ignored,...frozenContext}=context
 const refs:AlertRefs={queryId:t.snapshot.snapshotId,queryDigest:t.snapshot.digest,definitionHash:answer.definitionHash,sourceWatermarks:answer.sourceWatermarks,context:frozenContext,quality:quality.evidence}
 const observation:Observation={id:randomUUID(),ruleId:id,requestId,generation:row.generation+1,baseline,qualifying,triggered,resultHash:hash,answer,refs,createdAt:now}
 const changes:D1Sql[]=[],transitions:Transition[]=[]
 if(qualifying) {
  if(!episode) {
   episode={id:randomUUID(),ruleId:id,state:'open',openedObservationId:observation.id,lastObservationId:observation.id,closedObservationId:null,observationCount:1,acknowledgedAt:null,snoozedUntil:null,openedAt:now,closedAt:null}
   transitions.push(transition(row,ownerId,'opened',episode,observation,now))
  }else {
   episode={...episode,lastObservationId:observation.id,observationCount:episode.observationCount+1}
   transitions.push(transition(row,ownerId,'observed',episode,observation,now))
  }
  changes.push(saveEpisode(episode))
 }else if(episode) {
  episode={...episode,state:'closed',lastObservationId:observation.id,closedObservationId:observation.id,closedAt:now}
  changes.push(saveEpisode(episode));transitions.push(transition(row,ownerId,'recovered',episode,observation,now))
 }
 const evaluation={observation,episode}
 try {
  await transact(env.DB,authority,[assertion(ruleGuard(row)),...guards.map(assertion),sql('INSERT INTO bf_alert_observations(id,rule_id,request_id,generation,result_hash,payload_json,created_at) VALUES(?,?,?,?,?,?,?)',observation.id,id,requestId,observation.generation,hash,canonicalJson(evaluation),now),...changes,...transitions.map(saveTransition),sql('UPDATE bf_alert_rules SET generation=?,baseline_observation_id=?,last_observation_id=?,qualifying=? WHERE id=?',observation.generation,row.baseline_observation_id??observation.id,observation.id,qualifying?1:0,id)])
  return evaluation
 }catch(error) {
  // One read resolves a concurrent duplicate; other optimistic races refuse without retries.
  const committed=await priorEvaluation(env,id,requestId)
  if(committed)return replayEvaluation(env,authority,ownerId,id,guards,committed)
  throw error
 }
}

export async function alertAction(env:Bindings,authority:Authority,ownerId:string,id:string,action:'reset'|'acknowledge'|'snooze',episodeId:string|null,until:string|null) {
 const row=await readRule(env,ownerId,id),episode=await openEpisode(env,id),now=new Date().toISOString()
 if(action!=='reset'&&(!episode||episode.id!==episodeId))fail('alert_open_episode_required',409)
 const {t,sources,context,quality,guards}=await currentInputs(env,authority,ownerId,row)
 const previous=row.last_observation_id?await env.DB.prepare('SELECT payload_json FROM bf_alert_observations WHERE id=? AND rule_id=?').bind(row.last_observation_id,id).first<{payload_json:string}>():null
 const observation=previous?(JSON.parse(previous.payload_json) as Evaluation).observation:null,changes:D1Sql[]=[]
 if(row.last_observation_id&&!observation)fail('alert_baseline_unavailable',409)
 let updated=episode
 if(action==='reset') {
  if(episode){updated={...episode,state:'closed',closedAt:now,closedObservationId:observation?.id??null};changes.push(saveEpisode(updated))}
  changes.push(sql('UPDATE bf_alert_rules SET generation=generation+1,baseline_observation_id=NULL,last_observation_id=NULL,qualifying=0 WHERE id=?',id))
 }else {
  updated=action==='acknowledge'?{...episode!,acknowledgedAt:now}:{...episode!,snoozedUntil:until}
  changes.push(saveEpisode(updated),sql('UPDATE bf_alert_rules SET generation=generation+1 WHERE id=?',id))
 }
 const audit=transition(row,ownerId,action==='acknowledge'?'acknowledged':action==='snooze'?'snoozed':'reset',updated,observation,now,until)
 const {guards:ignored,...frozenContext}=context
 audit.actionRefs={queryId:t.snapshot.snapshotId,queryDigest:t.snapshot.digest,definitionHash:t.snapshot.answer.definitionHash,sourceWatermarks:sources.map(s=>({dataset:s.id,revision:s.revision,updatedAt:s.table.updatedAt,sha256:sha256(s.value_json)})),context:frozenContext,quality:quality.evidence}
 await transact(env.DB,authority,[assertion(ruleGuard(row)),...guards.map(assertion),...(previous?[assertion(sql('EXISTS(SELECT 1 FROM bf_alert_observations WHERE id=? AND rule_id=? AND payload_json=?)',row.last_observation_id,id,previous.payload_json))]:[]),...changes,saveTransition(audit)])
 return updated
}
