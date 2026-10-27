import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { plus, times } from '../../currency/decimal'
import { date } from '../../calendars/date'
import { fail, type Cell } from '../../query/types'
import type { Column } from '../../imports/files/csv'
import { preparationDecimal as decimal, exactDecimal } from '../decimal'
import type { Expr, Select } from './parser'
import type { Frame, Ref, Scope } from './types'

export type Evaluation = { type:Column['type']; refs:Ref[]; nullLiteral?:boolean; value:(row:Cell[])=>Cell }
const refs=(...groups:Ref[][])=>[...new Map(groups.flat().map(r=>[canonicalJson(r),r])).values()]
const castType=(type:string):Column['type']=>['varchar','string'].includes(type)?'text':['numeric','decimal','integer','int'].includes(type)?'number':type as Column['type']
function convert(value:Cell,type:string):Cell {
 if(value===null)return null
 if(castType(type)==='text')return String(value)
 if(castType(type)==='number'||type==='money'){
  const n=decimal(value)
  if(['integer','int'].includes(type)&&n.denominator!==1n)fail('dbt_integer_conversion_failed')
  if(type==='money'&&100n%n.denominator!==0n)fail('dbt_money_precision')
  return exactDecimal(n)
 }
 if(type==='date')return date(String(value))
 if(type==='boolean'&&(value===true||value===false||value==='true'||value==='false'))return value===true||value==='true'
 fail('dbt_type_conversion_failed')
}
export function compile(expr:Expr,frame:Scope):Evaluation {
 if(expr.op==='column'){
  const indexes=frame.columns.flatMap((c,i)=>c.name===expr.name&&(!expr.qualifier||expr.qualifier===c.qualifier)?[i]:[])
  if(!indexes.length)fail('dbt_column_not_found')
  if(indexes.length>1)fail('dbt_ambiguous_column')
  const index=indexes[0]
  return {type:frame.columns[index].type,refs:frame.columns[index].refs,value:row=>row[index]}
 }
 if(expr.op==='literal')return {type:expr.type,refs:[],nullLiteral:expr.value===null,value:()=>expr.value===null?null:expr.type==='number'?exactDecimal(decimal(expr.value)):expr.value}
 if(expr.op==='cast'){
  const value=compile(expr.value,frame)
  return {type:castType(expr.type),refs:value.refs,value:row=>convert(value.value(row),expr.type)}
 }
 const left=compile(expr.left,frame),right=compile(expr.right,frame)
 if(left.type!=='number'||right.type!=='number')fail('dbt_numeric_expression_required')
 return {type:'number',refs:refs(left.refs,right.refs),value:row=>{
  const a=left.value(row),b=right.value(row)
  if(a===null||b===null)return null
  return exactDecimal(expr.op==='*'?times(decimal(a),decimal(b)):plus(decimal(a),expr.op==='-'?times(decimal(b),{numerator:-1n,denominator:1n}):decimal(b)))
 }}
}
export function projectDBT(select:Select,frame:Scope):Frame {
 const projections=select.projections.flatMap(p=>'star' in p?frame.columns.map(c=>({name:c.name,expression:{op:'column' as const,name:c.name,qualifier:c.qualifier}})):[p])
 if(projections.length>64||new Set(projections.map(p=>p.name)).size!==projections.length)fail('dbt_projection_columns_required')
 const compiled=projections.map(p=>compile(p.expression,frame))
 const result:Frame={columns:projections.map((p,i)=>({name:p.name,type:compiled[i].type})),rows:[],lineage:Object.fromEntries(projections.map((p,i)=>[p.name,compiled[i].refs]))}
 let bytes=new TextEncoder().encode(canonicalJson(result)).length
 for(const row of frame.rows){
  const output=compiled.map(c=>c.value(row));bytes+=new TextEncoder().encode(canonicalJson(output)).length+1
  if(bytes>1500000||result.rows.length>=10000)fail('dbt_result_limit')
  result.rows.push(output)
 }
 return result
}
