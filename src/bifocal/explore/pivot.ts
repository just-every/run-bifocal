import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { decimal } from '../currency/decimal'
import type { Snapshot } from '../data/snapshots/store'
import { fail, type Cell, type Measure } from '../query/types'
import type { ExportColumn } from './table-export'

export type PivotColumn=ExportColumn & {dimension?:string;measure?:string;pivotValue?:Cell;unit?:Measure['unit'];currency?:string}
function identity(value:Cell,type:string):string {
 if(value!==null&&(type==='number'||type==='money')) {
  const number=decimal(value)
  return canonicalJson({numerator:number.numerator.toString(),denominator:number.denominator.toString()})
 }
 return canonicalJson(value)
}
function compare(left:Cell,right:Cell,type:string):number {
 if(left===null||right===null)return left===right?0:left===null?-1:1
 if(type==='number'||type==='money') {
  const a=decimal(left),b=decimal(right),difference=a.numerator*b.denominator-b.numerator*a.denominator
  return difference<0n?-1:difference>0n?1:0
 }
 const a=canonicalJson(left),b=canonicalJson(right)
 return a<b?-1:a>b?1:0
}

/** Rotate complete already-authorized grouped values. No aggregate is
 * recomputed: distinct, ratios and weighted means keep their original totals.
 * Missing intersections are null, never invented zeroes. */
export function pivotTable(snapshot:Snapshot,pivot:string) {
 const {definition,answer}=snapshot,axis=definition.groupBy.indexOf(pivot),dimensions=definition.semantic?.dimensions
 if(axis<0||axis!==definition.groupBy.length-1||!dimensions)fail('pivot_requires_final_grouped_dimension',400)
 const grouped=definition.groupBy.map(name=>{
  const dimension=dimensions.find(dimension=>dimension.column===name)
  if(!dimension)fail('pivot_dimension_not_permitted',403)
  return dimension
 })
 const rowDimensions=definition.groupBy.slice(0,-1),rowTypes=grouped.slice(0,-1).map(dimension=>dimension.type),axisType=grouped[axis].type
 const domainByKey=new Map<string,Cell>(),groups=new Map<string,{dimensions:Cell[];cells:Map<string,typeof answer.rows[number]>}>()
 for(const row of answer.rows) {
  const value=row.dimensions[axis],columnKey=identity(value,axisType),rowValues=row.dimensions.slice(0,-1),rowKey=canonicalJson(rowValues.map((value,index)=>identity(value,rowTypes[index])))
  if(!domainByKey.has(columnKey))domainByKey.set(columnKey,value)
  let group=groups.get(rowKey)
  if(!group){group={dimensions:rowValues,cells:new Map()};groups.set(rowKey,group)}
  if(group.cells.has(columnKey))fail('pivot_group_collision',409)
  group.cells.set(columnKey,row)
 }
 const domain=[...domainByKey.values()].sort((left,right)=>compare(left,right,axisType))
 const columns:PivotColumn[]=[...rowDimensions.map((name,index)=>({name,type:rowTypes[index],dimension:name})),...domain.flatMap(value=>definition.measures.map(measure=>({name:pivot+'='+JSON.stringify(value)+' · '+measure.id,type:measure.unit==='money'?'money':'number',measure:measure.id,pivotValue:value,unit:measure.unit,...measure.unit==='money'?{currency:snapshot.context.currency}:{}})))]
 const ordered=[...groups.values()].sort((left,right)=>{
  for(let index=0;index<rowTypes.length;index++){const order=compare(left.dimensions[index],right.dimensions[index],rowTypes[index]);if(order)return order}
  return 0
 })
 // Rows are materialized on access, so paging a sparse domain never allocates
 // its entire Cartesian grid. Array slice and map still give the common page and
 // export paths the same typed matrix, with stable complete headers.
 const rows:Cell[][]=new Array(ordered.length)
 ordered.forEach((group,index)=>Object.defineProperty(rows,index,{enumerable:true,configurable:false,get:()=>[...group.dimensions,...domain.flatMap(value=>{
  const row=group.cells.get(identity(value,axisType))
  return definition.measures.map(measure=>row?.values[measure.id].state==='value'?row.values[measure.id].value:null)
 })]}))
 return {columns,rows,totalRows:rows.length,scope:'summary' as const,layout:'pivot' as const,rowDimensions,pivot:{dimension:pivot,domain,measureIds:definition.measures.map(measure=>measure.id)},totals:answer.totals}
}
