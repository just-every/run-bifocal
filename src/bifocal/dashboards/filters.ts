import { exactKeys } from '../models/validation/transport'
import { fail, type Filter, type Query } from '../query/types'
import { queryInput } from '../query/validate'

/** Reader context only narrows retained definitions; source rules stay intact. */
export function dashboardFilters(value:unknown):Filter[] {
 if(value===undefined)return []
 if(!Array.isArray(value)||value.length>8)fail('bounded_dashboard_filters_required',400)
 const columns=new Set<string>()
 return value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))fail('dashboard_filter_required',400)
  const input=item as Record<string,unknown>;exactKeys(input,['column','op','value'])
  if(typeof input.column!=='string'||!input.column||input.column.length>200||columns.has(input.column)||input.op!=='eq'||!(input.value===null||typeof input.value==='boolean'||typeof input.value==='string'&&input.value.length<=4096))fail('dashboard_equality_filter_required',400)
  columns.add(input.column)
  return {column:input.column,op:'eq',value:input.value} as Filter
 })
}
export function dashboardFields(value:unknown):string[]|null {
 if(value===undefined||value===null)return null
 if(!Array.isArray(value)||!value.length||value.length>4||!value.every(field=>typeof field==='string'&&field.length>0&&field.length<=200)||new Set(value).size!==value.length)fail('dashboard_field_selection_required',400)
 return value as string[]
}
export function filteredDashboardQuery(definition:Query,filters:Filter[],fields:string[]|null=null):Query {
 if(fields?.some(field=>!definition.groupBy.includes(field)))fail('dashboard_field_selection_unavailable',409)
 if(filters.some(filter=>!definition.groupBy.includes(filter.column)))fail('dashboard_filter_dimension_unavailable',409)
 return queryInput({...definition,groupBy:fields??definition.groupBy,filters:[...definition.filters,...filters]})
}
