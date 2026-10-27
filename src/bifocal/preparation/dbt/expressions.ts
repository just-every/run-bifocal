import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { plus, times } from '../../currency/decimal'
import { date } from '../../calendars/date'
import { fail, type Cell } from '../../query/types'
import type { Column } from '../../imports/files/csv'
import { preparationDecimal as decimal, exactDecimal } from '../decimal'
import type { Expr, Select } from './parser'
import type { Frame, Ref } from './types'

type Evaluation = { type:Column['type']; refs:Ref[]; value:(row:Cell[])=>Cell }
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
function compile(expr:Expr,frame:Frame):Evaluation {
 if(expr.op==='column'){
  const index=frame.columns.findIndex(c=>c.name===expr.name)
  if(index<0)fail('dbt_column_not_found')
  return {type:frame.columns[index].type,refs:frame.lineage[expr.name],value:row=>row[index]}
 }
 if(expr.op==='literal')return {type:expr.type,refs:[],value:()=>expr.value===null?null:expr.type==='number'?exactDecimal(decimal(expr.value)):expr.value}
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
export function projectDBT(select:Select,frame:Frame):Frame {
 const projections=select.projections.flatMap(p=>'star' in p?frame.columns.map(c=>({name:c.name,expression:{op:'column' as const,name:c.name}})):[p])
 if(projections.length>64||new Set(projections.map(p=>p.name)).size!==projections.length)fail('dbt_projection_columns_required')
 const compiled=projections.map(p=>compile(p.expression,frame))
 return {columns:projections.map((p,i)=>({name:p.name,type:compiled[i].type})),rows:frame.rows.map(row=>compiled.map(c=>c.value(row))),lineage:Object.fromEntries(projections.map((p,i)=>[p.name,compiled[i].refs]))}
}
