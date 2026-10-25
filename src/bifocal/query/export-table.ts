import type { Snapshot } from '../data/snapshots/store'
import type { ExportColumn } from '../explore/table-export'
import { execute } from './execute'
import { fail, type Cell, type Source } from './types'

/** Retained answers keep their original source bytes and query restrictions. */
export function retainedTable(snapshot:Snapshot,sources:Source[],underlying:boolean) {
 const query=snapshot.definition
 const physical:ExportColumn[]=[]
 for(const column of sources.find(source=>source.id===query.dataset)!.table.columns)physical.push({name:column.name,type:column.type})
 for(const join of query.joins)for(const column of sources.find(source=>source.id===join.dataset)!.table.columns)physical.push({name:join.as+'.'+column.name,type:column.type})
 const dimensions=query.semantic?.dimensions.map(dimension=>({name:dimension.column,type:dimension.type}))??physical
 const type=(name:string)=>dimensions.find(column=>column.name===name)?.type??physical.find(column=>column.name===name||'base.'+column.name===name)?.type??fail('retained_dimension_unavailable',409)
 if(!underlying)return {columns:[...query.groupBy.map(name=>({name,type:type(name)})),...query.measures.map(measure=>({name:measure.id,type:measure.unit==='money'?'money':'number'}))],rows:snapshot.answer.rows.map(row=>[...row.dimensions,...query.measures.map(measure=>row.values[measure.id].state==='value'?row.values[measure.id].value:null)])}
 const rows:Cell[][]=[]
 execute(query,sources,snapshot.context,(scoped,resolve)=>{for(const row of scoped)rows.push(dimensions.map(column=>row[resolve(column.name)]??null))})
 return {columns:dimensions,rows}
}
