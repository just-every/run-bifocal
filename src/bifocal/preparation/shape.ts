import { fail, type Cell } from '../query/types'
import { preparationDecimal } from './decimal'
import type { Frame } from './execute'

const label=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>128)fail('preparation_name_required',400);return v}
const position=(frame:Frame,v:unknown)=>{const i=frame.columns.findIndex(c=>c.name===label(v));if(i<0)fail('preparation_column_not_found');return i}
const columns=(v:unknown):string[]=>{if(!Array.isArray(v)||!v.length||v.length>64)fail('preparation_columns_required',400);const names=v.map(label);if(new Set(names).size!==names.length)fail('duplicate_preparation_column',400);return names}
/** Schema-only operations keep the source-pinned column references. */
export function shapePreparation(frame:Frame,step:Record<string,unknown>):boolean {
 const op=step.op
 const keys=(allowed:string[])=>{if(Object.keys(step).some(k=>!allowed.includes(k)))fail('unsupported_preparation_input',400)}
 if(op==='rename'){
  keys(['op','from','to']);const i=position(frame,step.from),to=label(step.to),from=frame.columns[i].name
  if(frame.columns.some(c=>c.name===to))fail('preparation_rename_conflict')
  frame.columns[i]={...frame.columns[i],name:to};frame.lineage[to]=frame.lineage[from];delete frame.lineage[from]
 }else if(op==='select'||op==='remove'||op==='reorder'){
  keys(['op','columns']);const selected=columns(step.columns),positions=selected.map(c=>position(frame,c))
  if(op==='reorder'&&positions.length!==frame.columns.length)fail('preparation_reorder_complete_schema_required')
  const indices=op==='remove'?frame.columns.map((_,i)=>i).filter(i=>!positions.includes(i)):positions
  if(!indices.length)fail('preparation_columns_required',400)
  frame.columns=indices.map(i=>frame.columns[i]);frame.rows=frame.rows.map(row=>indices.map(i=>row[i]));frame.lineage=Object.fromEntries(frame.columns.map(c=>[c.name,frame.lineage[c.name]]))
 }else if(op==='sort'){
  keys(['op','columns'])
  if(!Array.isArray(step.columns)||!step.columns.length||step.columns.length>64)fail('preparation_columns_required',400)
  const order=step.columns.map(v=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('preparation_sort_required',400);const s=v as Record<string,unknown>;if(Object.keys(s).some(k=>!['column','direction'].includes(k))||!['asc','desc'].includes(String(s.direction)))fail('preparation_sort_required',400);return {index:position(frame,s.column),direction:s.direction==='asc'?1:-1}})
  if(new Set(order.map(s=>s.index)).size!==order.length)fail('duplicate_preparation_column',400)
  const compare=(a:Cell,b:Cell,i:number)=>{
   if(a===b)return 0
   if(a===null)return -1
   if(b===null)return 1
   if(['number','money'].includes(frame.columns[i].type)){const x=preparationDecimal(a),y=preparationDecimal(b),d=x.numerator*y.denominator-y.numerator*x.denominator;return d<0n?-1:d>0n?1:0}
   // Ordinal comparison is explicit; locale-sensitive source sorts stay unsupported.
   return a<b?-1:1
  }
  frame.rows.sort((a,b)=>{for(const s of order){const c=compare(a[s.index],b[s.index],s.index);if(c)return c*s.direction}return 0})
 }else return false
 return true
}
