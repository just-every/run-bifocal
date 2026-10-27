import { decimal, plus, rational } from '../currency/decimal'
import type { Table } from '../imports/files/csv'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
export type RuleDefinition={name:string;kind:'freshness'|'not-null'|'unique'|'accepted-values'|'count'|'money';column?:string;maxAgeSeconds?:number;values?:unknown[];expected?:string}
export type SourceRow={revision:string;value_json:string}
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
