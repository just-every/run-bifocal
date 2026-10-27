import { exact, object, text } from '../metrics/transport'
import { fail, type Answer, type Context, type Query } from '../query/types'

export type Predicate = {kind:'threshold';measure:string;op:'gt'|'gte'|'lt'|'lte'|'eq';value:string}|{kind:'rows-exist'}|{kind:'no-rows'}|{kind:'results-changed'}
export type Comparison = {kind:'multiset'}|{kind:'stable-key';columns:string[]}
export type AlertDefinition = {title:string;queryId:string;predicate:Predicate;comparison:Comparison;behavior:'edge'|'every';baseline:'first-observation'}
export type AlertRule = AlertDefinition & {id:string;generation:number;baselineObservationId:string|null;lastObservationId:string|null;qualifying:boolean;createdAt:string}
export type AlertRefs = {queryId:string;queryDigest:string;definitionHash:string;sourceWatermarks:Answer['sourceWatermarks'];context:Omit<Context,'guards'>;quality:unknown[]}
export type Observation = {id:string;ruleId:string;requestId:string;generation:number;baseline:boolean;qualifying:boolean;triggered:boolean;resultHash:string;answer:Answer;refs:AlertRefs;createdAt:string}
export type Episode = {id:string;ruleId:string;state:'open'|'closed';openedObservationId:string;lastObservationId:string;closedObservationId:string|null;observationCount:number;acknowledgedAt:string|null;snoozedUntil:string|null;openedAt:string;closedAt:string|null}
export type Transition = {id:string;ruleId:string;episodeId:string|null;observationId:string|null;kind:'opened'|'observed'|'recovered'|'reset'|'acknowledged'|'snoozed';refs:AlertRefs|null;actionRefs?:AlertRefs;createdAt:string;actorId:string;until:string|null}
export type Evaluation = {observation:Observation;episode:Episode|null}
export const uuid=(v:unknown):string=>{if(typeof v!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))fail('uuid_required',400);return v.toLowerCase()}
const decimalPattern=/^-?(?:0|[1-9]\d{0,79})(?:\.\d{1,24})?$/
export function definition(v:Record<string,unknown>,query:Query):AlertDefinition {
 exact(v,['title','queryId','predicate','comparison','behavior','baseline'])
 if(!object(v.predicate)||!object(v.comparison))fail('alert_predicate_and_comparison_required',400)
 const p=v.predicate,c=v.comparison
 if(p.kind==='threshold') {
  exact(p,['kind','measure','op','value'])
  if(typeof p.measure!=='string'||!query.measures.some(m=>m.id===p.measure)||!['gt','gte','lt','lte','eq'].includes(String(p.op))||typeof p.value!=='string'||!decimalPattern.test(p.value))fail('invalid_alert_threshold',400)
 }else {exact(p,['kind']);if(!['rows-exist','no-rows','results-changed'].includes(String(p.kind)))fail('invalid_alert_predicate',400)}
 if(c.kind==='multiset')exact(c,['kind'])
 else if(c.kind==='stable-key') {
  exact(c,['kind','columns'])
  if(!Array.isArray(c.columns)||!c.columns.length||c.columns.length>query.groupBy.length||new Set(c.columns).size!==c.columns.length||c.columns.some(ref=>typeof ref!=='string'||!query.groupBy.includes(ref)))fail('invalid_alert_stable_key',400)
 }else fail('invalid_alert_comparison',400)
 if(v.behavior!=='edge'&&v.behavior!=='every')fail('invalid_alert_behavior',400)
 if(v.baseline!=='first-observation')fail('first_observation_baseline_required',400)
 return {title:text(v.title,160),queryId:uuid(v.queryId),predicate:p as Predicate,comparison:c as Comparison,behavior:v.behavior,baseline:v.baseline}
}
