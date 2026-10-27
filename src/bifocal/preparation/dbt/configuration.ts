import type { ProjectResource } from '../../imports/models/readers/types'
import { fail } from '../../query/types'
import { object } from './types'

// Only descriptive project metadata has native execution meaning. Hooks,
// materializations, variables, packages and adapter settings are never applied.
export function dbtConfiguration(resource:ProjectResource) {
 const d=resource.definition
 const allowed=resource.kind==='project'?['name','version','config-version','profile','model-paths','test-paths','clean-targets','target-path','require-dbt-version']
  :resource.kind==='source'?['name','description','columns','source']:resource.kind==='model'?['sql','schema']:['test','column']
 if(Object.keys(d).some(k=>!allowed.includes(k)))fail('unsupported_dbt_configuration')
 if(resource.kind==='model'&&object(d.schema)){
  if(Object.keys(d.schema).some(k=>!['name','description','columns','tests','data_tests'].includes(k)))fail('unsupported_dbt_configuration')
  checkColumns(d.schema.columns)
 }
 if(resource.kind==='source'){
  if(!object(d.source)||Object.keys(d.source).some(k=>!['name','description','tables'].includes(k)))fail('unsupported_dbt_configuration')
  checkColumns(d.columns)
  if(Array.isArray(d.columns)&&d.columns.some(c=>object(c)&&(c.tests!==undefined||c.data_tests!==undefined)))fail('unsupported_dbt_source_test')
 }
}
function checkColumns(columns:unknown){
 if(columns===undefined)return
 if(!Array.isArray(columns)||columns.some(c=>!object(c)||Object.keys(c).some(k=>!['name','description','tests','data_tests'].includes(k))))fail('unsupported_dbt_configuration')
}
