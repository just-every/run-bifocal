import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { ProjectResource } from '../../imports/models/readers/types'
import { fail } from '../../query/types'
import { preparationDecimal, exactDecimal } from '../decimal'
import { object, type Frame, type TestResult } from './types'

/** Imported generic declarations are interpreted directly, never dispatched
 * through dbt macros. Configured, conditional and custom tests remain unsupported. */
export function runDBTTest(resource:ProjectResource,models:Map<string,Frame>):TestResult {
 if(resource.dependencies.length!==1)fail('unsupported_dbt_test')
 const model=resource.dependencies[0],frame=models.get(model)
 if(!frame)fail('dbt_dependency_failed')
 let declaration=resource.definition.test
 if(object(declaration)){
  const entries=Object.entries(declaration)
  if(entries.length!==1||!object(entries[0][1])||Object.keys(entries[0][1]).length)fail('unsupported_dbt_test')
  declaration=entries[0][0]
 }
 if(declaration!=='not_null'&&declaration!=='unique')fail('unsupported_dbt_test')
 const prefix=model.slice('model.'.length)+'.'
 if(!resource.name.startsWith(prefix))fail('dbt_column_test_required')
 const column=resource.name.slice(prefix.length),index=frame.columns.findIndex(c=>c.name===column)
 if(index<0)fail('dbt_test_column_not_found')
 let failures=0
 if(declaration==='not_null')failures=frame.rows.filter(row=>row[index]===null).length
 else {
  const counts=new Map<string,number>()
  for(const row of frame.rows){const value=row[index];if(value===null)continue;const key=canonicalJson(['number','money'].includes(frame.columns[index].type)?exactDecimal(preparationDecimal(value)):value);counts.set(key,(counts.get(key)??0)+1)}
  for(const count of counts.values())if(count>1)failures+=count
 }
 return {resource:resource.id,model,column,test:declaration,status:failures?'failed':'passed',failures}
}
