import { issue, record } from './common'
import type { Cell, Filter } from '../../../query/types'
import type { Dimension, Explore, Project, ProjectResource } from './types'

export type MetabaseField = {name:string;type:Dimension['type']}
export function metabaseField(value:unknown, fields:Map<unknown,MetabaseField>):MetabaseField|null {
 return Array.isArray(value)&&value.length===3&&value[0]==='field'&&value[2]===null?fields.get(value[1])??null:null
}

// Translate only a conjunction of physical-field predicates. An unrecognized
// branch invalidates the entire project; it never becomes a broader query.
export function metabaseQuery(p:Project, resource:ProjectResource, query:Record<string,unknown>, fields:Map<unknown,MetabaseField>, explore:Explore) {
 const unsupported=(value:unknown)=>issue(p,resource,resource.id,'unsupported_metabase_predicate','Translate the complete physical-field predicate before publication.',JSON.stringify(value))
 const filters:Filter[]=[]
 const literal=(value:unknown,field:MetabaseField):Cell|undefined=>{
  if(field.type==='boolean')return typeof value==='boolean'?value:undefined
  if(field.type==='text'||field.type==='date')return typeof value==='string'&&value.length<=4096?value:undefined
  if(field.type==='number'||field.type==='money')return typeof value==='number'&&Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value))?String(value):undefined
  return undefined
 }
 const visit=(value:unknown,depth=0):void=>{
  if(depth>16||!Array.isArray(value)||filters.length>=20){unsupported(value);return}
  if(value[0]==='and'){
   if(value.length<3){unsupported(value);return}
   for(const child of value.slice(1))visit(child,depth+1)
   return
  }
  const field=metabaseField(value[1],fields)
  if(!field){unsupported(value);return}
  if(value[0]==='is-null'&&value.length===2){filters.push({column:field.name,op:'is-null'});return}
  const values=value.slice(2).map(v=>literal(v,field))
  if(values.some(v=>v===undefined)||!values.length){unsupported(value);return}
  if(value[0]==='='&&values.length<=100){filters.push({column:field.name,op:values.length===1?'eq':'in',value:values.length===1?values[0]:values as Cell[]});return}
  if(['>=','<='].includes(value[0])&&values.length===1&&['number','money','date'].includes(field.type)){filters.push({column:field.name,op:value[0]==='>='?'gte':'lte',value:values[0]});return}
  if(value[0]==='between'&&values.length===2&&['number','money','date'].includes(field.type)){
   filters.push({column:field.name,op:'gte',value:values[0]},{column:field.name,op:'lte',value:values[1]});return
  }
  unsupported(value)
 }
 if(query.filter!==undefined)visit(query.filter)
 if(filters.length>20)unsupported(query.filter)
 explore.filters=filters
 if(query.breakout===undefined)return []
 if(!Array.isArray(query.breakout)||query.breakout.length>4){unsupported(query.breakout);return []}
 const groups=query.breakout.map(value=>metabaseField(value,fields))
 if(groups.some(f=>!f)||new Set(groups.map(f=>f?.name)).size!==groups.length){unsupported(query.breakout);return []}
 explore.groupBy=groups.map(f=>f!.name)
 return explore.groupBy
}

export function metabaseOutputs(p:Project,resource:ProjectResource,outputs:unknown,groups:string[],count:number) {
 if(!Array.isArray(outputs)||outputs.length!==groups.length+count){issue(p,resource,resource.id,'metabase_execution_pending','Include the exact breakout and aggregate result field names.');return null}
 for(const [index,output] of outputs.entries()){
  if(!record(output)||Object.keys(output).some(k=>!['name','base_type','display_name','source','field_ref'].includes(k))){issue(p,resource,resource.id,'unsupported_metabase_output','Translate every result metadata property.');continue}
  if(index<groups.length&&output.name!==groups[index]||output.source!==undefined&&output.source!==(index<groups.length?'breakout':'aggregation'))issue(p,resource,resource.id,'unsupported_metabase_output','Result metadata must retain the declared breakout and aggregate order.')
  if(output.field_ref!==undefined&&index>=groups.length&&JSON.stringify(output.field_ref)!==JSON.stringify(['aggregation',index-groups.length]))issue(p,resource,resource.id,'unsupported_metabase_output','Resolve this aggregate result reference exactly.')
 }
 return outputs.slice(groups.length)
}
