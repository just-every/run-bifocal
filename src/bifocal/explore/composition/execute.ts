import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { decimal } from '../../currency/decimal'
import { execute } from '../../query/execute'
import { fail, type Cell, type Source, type Value } from '../../query/types'
import type { Snapshot } from '../../data/snapshots/store'
import type { ExportColumn } from '../table-export'
export type Operation={operation:'join'|'append';join:'left'|'inner'|'full'}
export type Subject={snapshot:Snapshot;sources:Source[]}
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b)
const baseName=(column:string)=>column.startsWith('base.')?column.slice(5):column
function inspect(subject:Subject) {
 const {definition:query,context,answer}=subject.snapshot,key=query.groupBy[0],dimension=query.semantic!.dimensions.find(d=>d.column===key)!
 const identity=(value:Cell)=>{if(value!==null&&['number','money'].includes(dimension.type)){const n=decimal(value);return canonicalJson([n.numerator.toString(),n.denominator.toString()])}return canonicalJson(value)}
 const groups=new Map(answer.rows.map(row=>[identity(row.dimensions[0]),row]))
 if(groups.size!==answer.rows.length)fail('composition_summary_grain_not_unique',409)
 let allowed:Record<string,Cell>[]=[]
 execute(query,subject.sources,context,(rows)=>{allowed=rows})
 const keyRef='base.'+baseName(key)
 return {subject,query,context,answer,key,dimension,identity,groups,allowed,keyRef}
}
type Inspected=ReturnType<typeof inspect>
function select(side:Inspected,keys:Set<string>) {
 const {query,context,subject}=side,base=subject.sources.find(s=>s.id===query.dataset)!,index=base.table.columns.findIndex(c=>c.name===baseName(side.key))
 if(index<0)fail('composition_base_key_required',409)
 // Only real retained base rows are narrowed, before the same exact engine
 // reapplies subject rules/joins. No invented table or saved answer is executed.
 const sources=subject.sources.map(source=>source.id===base.id?{...source,table:{...source.table,rows:source.table.rows.filter(row=>keys.has(side.identity(row[index] as Cell)))}}:source)
 const answer=execute({...query,groupBy:[]},sources,context)
 const rows=side.allowed.filter(row=>keys.has(side.identity(row[side.keyRef]??null)))
 return {answer,rows}
}
export function compose(leftSubject:Subject,rightSubject:Subject,operation:Operation) {
 const left=inspect(leftSubject),right=inspect(rightSubject)
 if(left.dimension.type!==right.dimension.type)fail('composition_key_type_mismatch',409)
 const contextShape=(s:Inspected)=>({accountingBasis:s.query.context.accountingBasis,rounding:s.query.context.rounding,timezone:s.context.timezone,currency:s.context.currency,calendar:s.context.calendar,rateSource:s.context.rateSource})
 if(!same(contextShape(left),contextShape(right)))fail('composition_context_mismatch',409)
 if(operation.operation==='append'&&(!same(left.query.semantic!.dimensions,right.query.semantic!.dimensions)||!same(left.query.measures,right.query.measures)||baseName(left.key)!==baseName(right.key)))fail('composition_append_schema_mismatch',409)
 const matched=new Set([...left.groups].filter(([key,row])=>row.dimensions[0]!==null&&right.groups.has(key)).map(([key])=>key))
 const leftKeys=new Set(operation.operation==='append'||operation.join!=='inner'?left.groups.keys():matched)
 const rightKeys=new Set(operation.operation==='append'||operation.join==='full'?right.groups.keys():matched)
 const selectedLeft=select(left,leftKeys),selectedRight=select(right,rightKeys)
 const columns:ExportColumn[]=[...(operation.operation==='append'?[{name:'subject',type:'text'}]:[]),{name:'key',type:left.dimension.type},...left.query.measures.map(m=>({name:'left-'+m.id,type:m.unit==='money'?'money':'number'})),...right.query.measures.map(m=>({name:'right-'+m.id,type:m.unit==='money'?'money':'number'}))]
 let complete=true
 const values=(side:Inspected,key:string|undefined)=>side.query.measures.map(m=>{const value=key===undefined?undefined:side.groups.get(key)?.values[m.id];if(value&&!['value','null'].includes(value.state))complete=false;return value?.state==='value'?value.value:null})
 const rows:Cell[][]=[],valueStates:Record<string,string>[]=[]
 const states=(leftKey:string|undefined,rightKey:string|undefined)=>Object.fromEntries(([
  ['left',left,leftKey],['right',right,rightKey],
 ] as const).flatMap(([tag,side,key])=>side.query.measures.map(m=>[tag+'-'+m.id,key===undefined?'unmatched':side.groups.get(key)?.values[m.id].state??'unmatched'])))
 if(operation.operation==='append') {
  for(const [tag,side] of [['left',left],['right',right]] as const)for(const [key,row] of side.groups){rows.push([tag,row.dimensions[0],...values(left,tag==='left'?key:undefined),...values(right,tag==='right'?key:undefined)]);valueStates.push(states(tag==='left'?key:undefined,tag==='right'?key:undefined))}
 } else {
  for(const [key,row] of left.groups)if(leftKeys.has(key)){rows.push([row.dimensions[0],...values(left,key),...values(right,matched.has(key)?key:undefined)]);valueStates.push(states(key,matched.has(key)?key:undefined))}
  if(operation.join==='full')for(const [key,row] of right.groups)if(!matched.has(key)){rows.push([row.dimensions[0],...values(left,undefined),...values(right,key)]);valueStates.push(states(undefined,key))}
 }
 const diagnostics=(side:Inspected,selected:ReturnType<typeof select>,keys:Set<string>)=>({inputRows:side.answer.inputRows,eligibleRows:side.answer.filteredRows,excludedRows:side.answer.inputRows-side.answer.filteredRows,eligibleKeys:side.groups.size,matchingKeys:matched.size,unmatchedKeys:side.groups.size-matched.size,selectedKeys:keys.size,excludedKeys:side.groups.size-keys.size,selectedRows:selected.rows.length})
 const subjects={left:{snapshotId:leftSubject.snapshot.snapshotId,...leftSubject.snapshot.context.exploration,key:left.key,sourceWatermarks:left.answer.sourceWatermarks},right:{snapshotId:rightSubject.snapshot.snapshotId,...rightSubject.snapshot.context.exploration,key:right.key,sourceWatermarks:right.answer.sourceWatermarks}}
 const dimensions=(side:Inspected)=>side.query.semantic!.dimensions.filter(d=>!d.column.includes('.')||d.column.startsWith('base.'))
 const leftDimensions=dimensions(left),rightDimensions=dimensions(right)
 const underlyingColumns:ExportColumn[]=[{name:'subject',type:'text'},{name:'key',type:left.dimension.type},...leftDimensions.map(d=>({name:'left-'+d.column,type:d.type})),...rightDimensions.map(d=>({name:'right-'+d.column,type:d.type}))]
 const underlyingRows:Cell[][]=[]
 for(const [tag,side,selected] of [['left',left,selectedLeft],['right',right,selectedRight]] as const)for(const row of selected.rows)underlyingRows.push([tag,row[side.keyRef]??null,...leftDimensions.map(d=>tag==='left'?row['base.'+baseName(d.column)]??null:null),...rightDimensions.map(d=>tag==='right'?row['base.'+baseName(d.column)]??null:null)])
 const totals:{left:Record<string,Value>;right:Record<string,Value>}={left:selectedLeft.answer.totals,right:selectedRight.answer.totals}
 return {result:{columns,rows,valueStates,totals,diagnostics:{matchedKeys:matched.size,left:diagnostics(left,selectedLeft,leftKeys),right:diagnostics(right,selectedRight,rightKeys)},subjects,complete,commonSnapshot:'unavailable' as const,certification:'unavailable' as const},underlying:{columns:underlyingColumns,rows:underlyingRows}}
}
