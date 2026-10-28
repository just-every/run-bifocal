import type { ProjectResource } from '../../imports/models/readers/types'
import { fail, type Cell } from '../../query/types'
import { cellKey, compatibleTypes } from './relations'
import { object, type Frame, type TestResult } from './types'

type Declaration = {test:TestResult['test']; arguments:Record<string,unknown>}
function declaration(resource:ProjectResource):Declaration {
 let value=resource.definition.test,args:Record<string,unknown>={}
 if(object(value)){
  const entries=Object.entries(value)
  if(entries.length!==1||!object(entries[0][1]))fail('unsupported_dbt_test')
  value=entries[0][0];args=entries[0][1]
  if('arguments' in args){if(Object.keys(args).length!==1||!object(args.arguments))fail('unsupported_dbt_test');args=args.arguments}
 }
 if(!['not_null','unique','accepted_values','relationships'].includes(String(value)))fail('unsupported_dbt_test')
 const test=value as TestResult['test'],allowed=test==='accepted_values'?['values','quote']:test==='relationships'?['to','field']:[]
 if(Object.keys(args).some(k=>!allowed.includes(k)))fail('unsupported_dbt_test')
 return {test,arguments:args}
}
function target(args:Record<string,unknown>) {
 if(typeof args.to!=='string'||typeof args.field!=='string'||!args.field.length||args.field.length>128)fail('dbt_relationship_target_required')
 const match=/^\s*(ref|source)\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2(?:\s*,\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\4)?\s*\)\s*$/.exec(args.to)
 if(!match||match[1]==='source'&&!match[5]||match[1]==='ref'&&match[5])fail('dbt_relationship_target_required')
 return match[1]==='source'?`source.${match[3]}.${match[5]}`:`model.${match[3]}`
}

/** Resolve only literal relationship targets; no template or macro evaluation. */
export function dbtTestDependencies(resource:ProjectResource):string[] {
 const d=declaration(resource)
 return d.test==='relationships'?[...new Set([...resource.dependencies,target(d.arguments)])]:resource.dependencies
}

/** Generic declarations execute directly with nulls excluded except not_null.
 * Custom macros, conditional tests and test configurations stay unsupported. */
export function runDBTTest(resource:ProjectResource,frames:Map<string,Frame>):TestResult {
 if(resource.dependencies.length!==1)fail('unsupported_dbt_test')
 const model=resource.dependencies[0],frame=frames.get(model)
 if(!frame)fail('dbt_dependency_failed')
 const {test,arguments:args}=declaration(resource),prefix=model.slice('model.'.length)+'.'
 if(!resource.name.startsWith(prefix))fail('dbt_column_test_required')
 const column=resource.name.slice(prefix.length),index=frame.columns.findIndex(c=>c.name===column)
 if(index<0)fail('dbt_test_column_not_found')
 const type=frame.columns[index].type,key=(value:Cell)=>cellKey(value,type)
 let failures=0
 if(test==='not_null')failures=frame.rows.filter(row=>row[index]===null).length
 else if(test==='unique'){
  const counts=new Map<string,number>()
  for(const row of frame.rows){const value=row[index];if(value===null)continue;const k=key(value);counts.set(k,(counts.get(k)??0)+1)}
  for(const count of counts.values())if(count>1)failures+=count
 }else {
  let accepted:Set<string>
  if(test==='relationships'){
   const parent=frames.get(target(args))
   if(!parent)fail('dbt_dependency_failed')
   const parentIndex=parent.columns.findIndex(c=>c.name===args.field)
   if(parentIndex<0)fail('dbt_relationship_column_not_found')
   if(!compatibleTypes(type,parent.columns[parentIndex].type))fail('dbt_relationship_type_mismatch')
   accepted=new Set(parent.rows.filter(row=>row[parentIndex]!==null).map(row=>cellKey(row[parentIndex],parent.columns[parentIndex].type)))
  }else {
   if(!Array.isArray(args.values)||!args.values.length||args.values.length>1000||args.quote!==undefined&&typeof args.quote!=='boolean')fail('dbt_accepted_values_required')
   const quote=args.quote!==false
   accepted=new Set(args.values.map(value=>{
    if(quote){if(type!=='text'||typeof value!=='string')fail('dbt_test_values_type_mismatch');return key(value)}
    if(type==='boolean'&&typeof value==='boolean')return key(value)
    if(['number','money'].includes(type)&&(typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value)))return key(String(value))
    fail('dbt_test_values_type_mismatch')
   }))
  }
  failures=frame.rows.filter(row=>row[index]!==null&&!accepted.has(key(row[index]))).length
 }
 return {resource:resource.id,model,column,test,status:failures?'failed':'passed',failures}
}
