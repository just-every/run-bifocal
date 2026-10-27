import { fail } from '../../query/types'
import { object, type Bindings } from './types'

/** Bindings identify already authorized file tables, never provider credentials. */
export function dbtBindings(input:unknown):Bindings {
 if(!object(input)||Object.keys(input).length>128)fail('dbt_source_bindings_required',400)
 const bindings:Bindings=Object.create(null)
 for(const [resource,dataset] of Object.entries(input)){
  if(!/^source\.[A-Za-z_][A-Za-z0-9_.]*$/.test(resource)||resource.length>256||typeof dataset!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(dataset))fail('dbt_explicit_source_binding_required',400)
  bindings[resource]=dataset
 }
 return bindings
}
export const dbtDatasets=(bindings:Bindings):string[]=>[...new Set(Object.values(bindings))].sort()
