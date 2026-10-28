import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { fail, type Cell } from '../../query/types'
import { preparationDecimal, exactDecimal } from '../decimal'
import { compile, type Evaluation } from './expressions'
import type { Predicate, Select } from './parser'
import type { Frame, Scope } from './types'

const numeric=(type:string)=>type==='number'||type==='money'
export const compatibleTypes=(a:string,b:string)=>a===b||numeric(a)&&numeric(b)
export const cellKey=(value:Cell,type:string)=>canonicalJson(value!==null&&numeric(type)?exactDecimal(preparationDecimal(value)):value)
const scope=(frame:Frame,qualifier?:string):Scope=>({columns:frame.columns.map(c=>({...c,qualifier,refs:frame.lineage[c.name]})),rows:frame.rows})

function comparison(left:Evaluation,right:Evaluation) {
 if(!left.nullLiteral&&!right.nullLiteral&&!compatibleTypes(left.type,right.type))fail('dbt_comparison_type_mismatch')
 return (row:Cell[]):number|null=>{
  const a=left.value(row),b=right.value(row)
  if(a===null||b===null)return null
  if(numeric(left.type)){
   const x=preparationDecimal(a),y=preparationDecimal(b),difference=x.numerator*y.denominator-y.numerator*x.denominator
   return difference<0n?-1:difference>0n?1:0
  }
  return a<b?-1:a>b?1:0
 }
}
function predicate(value:Predicate,frame:Scope):(row:Cell[])=>boolean|null {
 if(value.op==='and'||value.op==='or'){
  const left=predicate(value.left,frame),right=predicate(value.right,frame)
  return row=>{const a=left(row),b=right(row);return value.op==='and'?a===false||b===false?false:a===null||b===null?null:true:a===true||b===true?true:a===null||b===null?null:false}
 }
 if(value.op==='null'){
  const expression=compile(value.value,frame)
  return row=>(expression.value(row)===null)!==value.negate
 }
 if(value.op==='in'){
  const expression=compile(value.value,frame),comparisons=value.values.map(v=>comparison(expression,compile(v,frame)))
  return row=>{const results=comparisons.map(c=>c(row));const found=results.includes(0)?true:results.includes(null)?null:false;return found===null?null:value.negate?!found:found}
 }
 const compare=comparison(compile(value.left,frame),compile(value.right,frame))
 return row=>{const n=compare(row);return n===null?null:value.operator==='='?n===0:['!=','<>'].includes(value.operator)?n!==0:value.operator==='<'?n<0:value.operator==='<='?n<=0:value.operator==='>'?n>0:n>=0}
}

/** A single indexed equijoin, with SQL null matching and explicit row bounds. */
export function relationDBT(select:Select,frames:Map<string,Frame>):Scope {
 const base=frames.get(select.relation)
 if(!base)fail('dbt_dependency_failed')
 let frame=scope(base,select.alias)
 if(select.join){
  const target=frames.get(select.join.relation)
  if(!target)fail('dbt_dependency_failed')
  const right=scope(target,select.join.alias),joined:Scope={columns:[...frame.columns,...right.columns],rows:[]}
  const a=select.join.left,b=select.join.right
  if(a.op!=='column'||b.op!=='column')fail('dbt_join_columns_required')
  const leftKey=compile(a.qualifier===select.alias?a:b,frame),rightKey=compile(a.qualifier===select.alias?b:a,right)
  if(!compatibleTypes(leftKey.type,rightKey.type))fail('dbt_join_type_mismatch')
  const index=new Map<string,Cell[][]>()
  for(const row of right.rows){const value=rightKey.value(row);if(value===null)continue;const key=cellKey(value,rightKey.type),matches=index.get(key)??[];matches.push(row);index.set(key,matches)}
  let bytes=0
  const append=(row:Cell[])=>{bytes+=new TextEncoder().encode(canonicalJson(row)).length+1;if(joined.rows.length>=10000||bytes>1500000)fail('dbt_result_limit');joined.rows.push(row)}
  for(const row of frame.rows){
   const value=leftKey.value(row),matches=value===null?undefined:index.get(cellKey(value,leftKey.type))
   if(matches)for(const match of matches)append([...row,...match])
   else if(select.join.kind==='left')append([...row,...right.columns.map(()=>null)])
  }
  frame=joined
 }
 if(select.where){const keep=predicate(select.where,frame);frame={...frame,rows:frame.rows.filter(row=>keep(row)===true)}}
 return frame
}
