import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { decimal } from '../currency/decimal'
import { addDays, date } from '../calendars/date'
import { FISCAL_WINDOWS, fiscalWindow, type CalendarDefinition } from '../calendars/fiscal'
import { fail, type Context, type Filter, type Query, type Source } from '../query/types'
export type SemanticShape = { grain: string[]; dimensions: {column:string;type:string}[]; hierarchies: string[][]; slowlyChanging: 'reject-duplicate-grain' }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const refs=(v:unknown,max:number):v is string[]=>Array.isArray(v)&&v.length>0&&v.length<=max&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=200)&&new Set(v).size===v.length
export function semanticInput(value:unknown):SemanticShape {
 if(!object(value)||Object.keys(value).some(k=>!['grain','dimensions','hierarchies','slowlyChanging'].includes(k))||!refs(value.grain,8)||!Array.isArray(value.dimensions)||!value.dimensions.length||value.dimensions.length>64||!Array.isArray(value.hierarchies)||value.hierarchies.length>8||value.slowlyChanging!=='reject-duplicate-grain')fail('invalid_semantic_shape',400)
 for(const dimension of value.dimensions)if(!object(dimension)||Object.keys(dimension).some(k=>!['column','type'].includes(k))||!refs([dimension.column],1)||!['text','number','money','date','boolean'].includes(String(dimension.type)))fail('invalid_typed_dimension',400)
 const dimensions=value.dimensions as SemanticShape['dimensions'], names=dimensions.map(d=>d.column)
 if(new Set(names).size!==names.length||!value.grain.every(g=>names.includes(g))||!value.hierarchies.every(h=>refs(h,8)&&h.every(column=>names.includes(column))))fail('semantic_dimension_reference_required',400)
 return value as SemanticShape
}
export function fiscalInput(value:unknown):NonNullable<Query['fiscal']> {
 if(!object(value)||Object.keys(value).some(k=>!['column','asOf','window'].includes(k))||!refs([value.column],1)||!FISCAL_WINDOWS.some(window=>window===value.window))fail('invalid_fiscal_window',400)
 try{date(value.asOf)}catch{fail('invalid_fiscal_cutoff',400)}
 return value as NonNullable<Query['fiscal']>
}
/** Freeze the cutoff with the selected native calendar; never use today's date. */
export function fiscalFilters(query:Query,context:Context):Filter[] {
 if(!query.fiscal)return []
 const definition=context.calendar.definition as unknown as CalendarDefinition, bounds=fiscalWindow(definition,query.fiscal.asOf,query.fiscal.window)
 return [{column:query.fiscal.column,op:'gte',value:bounds.start},{column:query.fiscal.column,op:'lte',value:addDays(bounds.end,-1)}]
}
/** A history table needs an explicit version key or a reviewed current-state source.
 * Duplicate business keys are refused; no arbitrary latest-row selection occurs. */
export function validateGrain(query:Query,base:Source,columns:Map<string,{type:string;alias:string}>,resolve:(s:string)=>string) {
 if(!query.semantic)return
 const shape=query.semantic
 for(const dimension of shape.dimensions)if(columns.get(resolve(dimension.column))!.type!==dimension.type)fail('semantic_dimension_type_changed',409)
 const indexes=shape.grain.map(column=>{const ref=resolve(column);if(columns.get(ref)!.alias!=='base')fail('grain_requires_base_dimensions',400);return base.table.columns.findIndex(c=>'base.'+c.name===ref)})
 const seen=new Set<string>()
 for(const row of base.table.rows){const values=indexes.map(i=>row[i]);if(values.some(v=>v===null))fail('null_model_grain',409);const key=canonicalJson(values.map((value,i)=>{if(['number','money'].includes(base.table.columns[indexes[i]].type)){const n=decimal(value);return [n.numerator.toString(),n.denominator.toString()]}return value}));if(seen.has(key))fail('duplicate_model_grain',409);seen.add(key)}
}
