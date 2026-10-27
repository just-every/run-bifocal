import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Authority } from '../catalog/authority.server'
import { sourceMatch } from '../data/snapshots/store'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { queryInput } from '../query/validate'
import { fail, type Filter, type Query, type Source } from '../query/types'
type Rule={version:number;definition_json:string;digest:string}
type Definition={columns:string[];filters:Filter[]}
export async function sourceRules(env:Bindings,sources:Source[]){
 return Promise.all(sources.map(async source=>{
  const row=await env.DB.prepare('SELECT version,definition_json,digest FROM bf_machine_source_rules WHERE dataset_id=?').bind(source.id).first<Rule>()
  if(row&&sha256(row.definition_json)!==row.digest)fail('source_policy_changed',409)
  const definition:Definition=row?JSON.parse(row.definition_json):{columns:source.table.columns.map(c=>c.name),filters:[]}
  return {source,definition,version:row?.version??0,...row?{digest:row.digest}:{},guard:row?sql('EXISTS(SELECT 1 FROM bf_machine_source_rules WHERE dataset_id=? AND version=? AND digest=?)',source.id,row.version,row.digest):sql('NOT EXISTS(SELECT 1 FROM bf_machine_source_rules WHERE dataset_id=?)',source.id)}
 }))
}
/** Every current source restriction intersects before aggregation. A restricted
 * joined source cannot disclose unmatched rows through left-join nulls. */
export function intersectSources(query:Query,rules:Awaited<ReturnType<typeof sourceRules>>):Query{
 const permitted=(ref:string)=>{
  const dot=ref.indexOf('.'),alias=dot<0?'base':ref.slice(0,dot),column=dot<0?ref:ref.slice(dot+1)
  const dataset=alias==='base'?query.dataset:query.joins.find(j=>j.as===alias)?.dataset
  if(!rules.find(r=>r.source.id===dataset)?.definition.columns.includes(column))fail('source_column_not_permitted',403)
 }
 const refs=[...query.groupBy,...query.filters.map(f=>f.column),...query.semantic?.grain??[],...query.fiscal?[query.fiscal.column]:[]]
 for(const measure of query.measures)for(const field of ['column','numerator','denominator','weight','stateColumn','currencyColumn','rateDateColumn'] as const)if(measure[field])refs.push(measure[field]!)
 for(const join of query.joins){refs.push(join.left,join.as+'.'+join.right);if(join.effective)refs.push(join.effective.asOf,join.as+'.'+join.effective.from,join.as+'.'+join.effective.to)}
 refs.forEach(permitted)
 const filters=[...query.filters]
 for(const rule of rules){
  const aliases=[...rule.source.id===query.dataset?['base']:[],...query.joins.filter(j=>j.dataset===rule.source.id).map(j=>j.as)]
  for(const alias of aliases){
   filters.push(...rule.definition.filters.map(f=>({...f,column:alias+'.'+f.column})))
   if(alias!=='base'&&rule.digest){const join=query.joins.find(j=>j.as===alias)!;filters.push({column:alias+'.'+join.right,op:'ne',value:null})}
  }
 }
 return queryInput({...query,filters})
}
export async function sourceRuleResponse(request:Request,env:Bindings,actor:Authority,path:string){
 const match=/^\/api\/operator\/credentials\/sources\/([a-z][a-z0-9-]{0,63})(\/review)?$/.exec(path)
 if(!match)return null
 const row=await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=?').bind(match[1]).first<Omit<Source,'table'>>()
 if(!row)fail('dataset_not_found',404)
 const source={...row,table:JSON.parse(row.value_json)},[current]=await sourceRules(env,[source])
 if(request.method==='GET'&&!match[2]){await transact(env.DB,actor,[assertion(sourceMatch(source)),assertion(current.guard)]);return json({definition:current.definition,version:current.version})}
 if(request.method!=='POST')fail('method_not_allowed',405)
 const input=await jsonBody(request);exactKeys(input,['previousVersion','columns','filters','reviewedDigest'])
 const version=current.version
 if(input.previousVersion!==version)fail('source_policy_version_conflict',409)
 if(!Array.isArray(input.columns)||!input.columns.every(c=>typeof c==='string'&&source.table.columns.some((f:{name:string})=>f.name===c))||new Set(input.columns).size!==input.columns.length)fail('source_columns_required',400)
 // Reuse the typed query filter grammar; execution validates types before release.
 const filters=queryInput({version:1,dataset:source.id,joins:[],groupBy:[],filters:input.filters,measures:[{id:'rows',op:'count',unit:'count',scale:0}],context:{modelVersion:'source-policy',metricVersion:'source-policy',accountingBasis:'not-applicable',calendar:{id:'source-policy',version:1},rounding:'half-even'}}).filters
 if(filters.some(f=>!source.table.columns.some((c:{name:string})=>c.name===f.column)))fail('source_filter_column_required',400)
 const definition={columns:input.columns,filters},value=canonicalJson(definition),digest=sha256(value),reviewedDigest=sha256(canonicalJson({definition,previousVersion:version,source:{id:source.id,revision:source.revision,digest:sha256(source.value_json)},actor:actor.id,authority:actor}))
 const guards=[assertion(sourceMatch(source)),assertion(current.guard)]
 if(match[2]){await transact(env.DB,actor,guards);return json({definition,version,reviewedDigest})}
 if(input.reviewedDigest!==reviewedDigest)fail('exact_source_policy_review_required',409)
 await transact(env.DB,actor,[...guards,sql('INSERT INTO bf_machine_source_rules(dataset_id,version,definition_json,digest) VALUES(?,?,?,?) ON CONFLICT(dataset_id) DO UPDATE SET version=excluded.version,definition_json=excluded.definition_json,digest=excluded.digest',source.id,version+1,value,digest),sql('INSERT INTO bf_machine_audit(id,credential_id,owner_id,actor_kind,action,recorded_at) VALUES(?,?,?,?,?,?)',randomUUID(),'source:'+source.id,actor.id,'human','source-policy-reviewed',new Date().toISOString())])
 return json({version:version+1,digest})
}
