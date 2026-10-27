import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { evaluate, type RuleDefinition, type SourceRow } from './evaluate'

type Rule={id:string;owner_id:string;dataset_id:string;rule_json:string}
type Run={id:string;source_revision:string|null;result_json:string;created_at:string}
type Waiver={owner_id:string;reason:string;expires_at:string;created_at:string}
export type QualityTest={dataset:string;state:string;reason:string;sourceRevision:string|null;ruleId?:string;ownerId?:string;name?:string;column?:string;runId?:string|null;runSourceRevision?:string|null;checkedAt?:string|null;href?:string;waiver?:{ownerId:string;reason:string;expiresAt:string;createdAt:string;active:boolean}|null}

/** The same exact evidence feeds retained readers and publication approvals.
 * No failing row values leave this owner-only inspection. */
export async function inspectQuality(env:Bindings,datasets:string[],ownerId?:string) {
 const tests:QualityTest[]=[],guards:D1Sql[]=[],schemas:{dataset:string;revision:string;columns:string[]}[]=[]
 let configured=false
 for(const dataset of [...new Set(datasets)].sort()) {
  const source=await env.DB.prepare('SELECT revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<SourceRow>()
  if(source)schemas.push({dataset,revision:source.revision,columns:JSON.parse(source.value_json).columns.map((column:{name:string})=>column.name)})
  guards.push(source?sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=? AND value_json=?)',dataset,source.revision,source.value_json):sql('NOT EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?)',dataset))
  const rules=(await env.DB.prepare('SELECT * FROM bf_quality_rules WHERE dataset_id=? AND (? IS NULL OR owner_id=?) ORDER BY id').bind(dataset,ownerId??null,ownerId??null).all<Rule>()).results
  guards.push(sql('(SELECT count(*) FROM bf_quality_rules WHERE dataset_id=? AND (? IS NULL OR owner_id=?))=?',dataset,ownerId??null,ownerId??null,rules.length))
  configured ||= rules.length>0
  if(!rules.length){tests.push({dataset,state:'unknown',reason:source?'no_quality_evidence':'source_unavailable',sourceRevision:source?.revision??null});continue}
  for(const rule of rules) {
   guards.push(sql('EXISTS(SELECT 1 FROM bf_quality_rules WHERE id=? AND owner_id=? AND dataset_id=? AND rule_json=?)',rule.id,rule.owner_id,dataset,rule.rule_json))
   const run=await env.DB.prepare('SELECT id,source_revision,result_json,created_at FROM bf_quality_runs WHERE rule_id=? ORDER BY rowid DESC LIMIT 1').bind(rule.id).first<Run>()
   guards.push(run?sql('EXISTS(SELECT 1 FROM bf_quality_runs WHERE rule_id=? AND id=? AND source_revision IS ? AND result_json=? AND created_at=? AND rowid=(SELECT max(rowid) FROM bf_quality_runs WHERE rule_id=?))',rule.id,run.id,run.source_revision,run.result_json,run.created_at,rule.id):sql('NOT EXISTS(SELECT 1 FROM bf_quality_runs WHERE rule_id=?)',rule.id))
   const def=JSON.parse(rule.rule_json) as RuleDefinition,saved=run?JSON.parse(run.result_json):null
   let state=source&&run&&run.source_revision===source.revision?saved.state:'unknown'
   let reason=!source?'source_unavailable':state==='unknown'?'source_changed_or_unchecked':saved.reason
   if(source&&def.kind==='freshness'&&state==='passed') {
    const live=evaluate(def,source);state=live.state;reason=live.reason
    const observed=live.observedAt??null
    // Recheck the clock in the mutation transaction, rather than freezing a
    // passing freshness result at review time.
    if(state==='passed')guards.push(sql("julianday(?) <= julianday('now') AND (julianday('now')-julianday(?))*86400 <= ?",observed,observed,def.maxAgeSeconds))
   }
   const waiver=run?await env.DB.prepare('SELECT owner_id,reason,expires_at,created_at FROM bf_quality_waivers WHERE run_id=?').bind(run.id).first<Waiver>():null
   if(run)guards.push(waiver?sql('EXISTS(SELECT 1 FROM bf_quality_waivers WHERE run_id=? AND owner_id=? AND reason=? AND expires_at=? AND created_at=?)',run.id,waiver.owner_id,waiver.reason,waiver.expires_at,waiver.created_at):sql('NOT EXISTS(SELECT 1 FROM bf_quality_waivers WHERE run_id=?)',run.id))
   tests.push({dataset,sourceRevision:source?.revision??null,ruleId:rule.id,ownerId:rule.owner_id,name:def.name,...(def.column?{column:def.column}:{}),runId:run?.id??null,runSourceRevision:run?.source_revision??null,checkedAt:run?.created_at??null,state,reason,href:run?'/app/quality#run-'+run.id:'/app/quality#rule-'+rule.id,waiver:waiver?{ownerId:waiver.owner_id,reason:waiver.reason,expiresAt:waiver.expires_at,createdAt:waiver.created_at,active:Date.parse(waiver.expires_at)>Date.now()}:null})
  }
 }
 return {quality:{state:tests.some(t=>t.state==='failed')?'at risk':!tests.length||tests.some(t=>t.state==='unknown')?'unknown':'healthy',configured,tests},guards,schemas}
}
export async function qualityState(env:Bindings,datasets:string[],ownerId?:string) {return (await inspectQuality(env,datasets,ownerId)).quality}
