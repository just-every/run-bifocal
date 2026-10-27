import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { decimal, rational } from '../currency/decimal'
import { fail, type Answer, type Query, type Source, type Value } from '../query/types'
import type { Comparison, Predicate } from './protocol'

function exactValue(value:Value) {
 if(value.state!=='value'||!value.exact||!value.value)fail('alert_result_unavailable',409)
 try{return rational(BigInt(value.exact.numerator),BigInt(value.exact.denominator))}catch{fail('alert_result_unavailable',409)}
}
/** Hash the typed result only; source clocks and incidental row order are provenance. */
export function resultHash(answer:Answer,query:Query,sources:Source[],comparison:Comparison):string {
 const columns=new Map<string,Source['table']['columns'][number]>()
 for(const binding of [{dataset:query.dataset,as:'base'},...query.joins]) {
  const source=sources.find(s=>s.id===binding.dataset)
  if(!source)fail('alert_dimension_unavailable',409)
  for(const column of source.table.columns)columns.set(`${binding.as}.${column.name}`,column)
 }
 const dimensions=query.groupBy.map(ref=>{
  const column=columns.get(ref)??columns.get(`base.${ref}`)
  if(!column)fail('alert_dimension_unavailable',409)
  return {ref,type:column.type}
 })
 const typedCell=(value:Answer['rows'][number]['dimensions'][number],index:number)=>{
  const type=dimensions[index].type
  if(value===null)return {type,value:null}
  if(type==='number'||type==='money'){const n=decimal(value);return {type,exact:{numerator:String(n.numerator),denominator:String(n.denominator)}}}
  return {type,value}
 }
 const typedValue=(value:Value)=>{
  if(value.state==='null')return {state:value.state,exact:null,unit:value.unit,nulls:value.nulls,excluded:value.excluded}
  const n=exactValue(value)
  return {state:value.state,exact:{numerator:String(n.numerator),denominator:String(n.denominator)},unit:value.unit,nulls:value.nulls,excluded:value.excluded}
 }
 // A null aggregate over an observed empty set is valid; unknown source states are not.
 const totals=Object.fromEntries(query.measures.map(m=>[m.id,typedValue(answer.totals[m.id])]))
 const keys=new Set<string>(),indices=comparison.kind==='stable-key'?comparison.columns.map(c=>query.groupBy.indexOf(c)):[]
 const rows=answer.rows.map(row=>{
  const cells=row.dimensions.map(typedCell)
  if(comparison.kind==='stable-key') {
   if(indices.some(i=>row.dimensions[i]===null))fail('alert_stable_key_null',409)
   const key=canonicalJson(indices.map(i=>cells[i]));if(keys.has(key))fail('alert_stable_key_not_unique',409);keys.add(key)
  }
  return canonicalJson({dimensions:cells,values:Object.fromEntries(query.measures.map(m=>[m.id,typedValue(row.values[m.id])]))})
 }).sort()
 return sha256(canonicalJson({dimensions,measures:query.measures.map(m=>({id:m.id,unit:m.unit})),rows,totals}))
}
/** Thresholds compare the exact scalar total, without rounded display values. */
export function qualifies(predicate:Predicate,answer:Answer,hash:string,previousHash:string):boolean {
 if(predicate.kind==='rows-exist')return answer.rows.length>0
 if(predicate.kind==='no-rows')return answer.rows.length===0
 if(predicate.kind==='results-changed')return hash!==previousHash
 const left=exactValue(answer.totals[predicate.measure]),right=decimal(predicate.value),difference=left.numerator*right.denominator-right.numerator*left.denominator
 return predicate.op==='gt'?difference>0n:predicate.op==='gte'?difference>=0n:predicate.op==='lt'?difference<0n:predicate.op==='lte'?difference<=0n:difference===0n
}
