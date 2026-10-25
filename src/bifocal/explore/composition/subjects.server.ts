import type { Bindings } from '../../../auth.server'
import type { Authority } from '../../catalog/authority.server'
import { readSources, prepareQuery } from '../../data/snapshots/store'
import { modelGuard, readModel, readDefinition } from '../../models/validation/store.server'
import { exactKeys } from '../../models/validation/transport'
import { scopedQuery } from '../../models/validation/protocol'
import { queryInput } from '../../query/validate'
import { queryContext } from '../../query/context'
import { fail } from '../../query/types'

export type SubjectInput={modelId:string;revision:string;viewId:string;groupBy:string[];filters:unknown[];fiscal?:unknown}
export async function prepareSubject(env:Bindings,actor:Authority,value:unknown) {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('composition_subject_required',400)
 const input=value as Record<string,unknown>;exactKeys(input,['modelId','revision','viewId','groupBy','filters','fiscal'])
 const model=await readModel(env,actor.id,String(input.modelId))
 if(!model.production||input.revision!==model.production)fail('published_model_changed',409)
 const view=(await readDefinition(env,model.production)).views.find(v=>v.id===input.viewId)
 if(!view?.query.semantic)fail('governed_view_required',404)
 const candidate=queryInput({...view.query,groupBy:input.groupBy,filters:input.filters,...input.fiscal===undefined?{}:{fiscal:input.fiscal}})
 const allowed=new Set(view.query.semantic.dimensions.map(d=>d.column))
 if(candidate.groupBy.length!==1||candidate.groupBy.some(c=>!allowed.has(c))||candidate.filters.some(f=>!allowed.has(f.column)))fail('composition_permitted_base_key_required',403)
 const key=candidate.groupBy[0]
 if(key.includes('.')&&!key.startsWith('base.')||key.startsWith('base.')&&key.slice(5).includes('.'))fail('composition_permitted_base_key_required',403)
 if(view.query.joins.some(join=>join.dataset===view.query.dataset))fail('composition_self_relationship_unavailable',409)
 if(input.fiscal!==undefined&&(!view.query.fiscal||candidate.fiscal?.column!==view.query.fiscal.column))fail('fiscal_dimension_not_permitted',403)
 const query=queryInput({...scopedQuery(view,model.production),groupBy:candidate.groupBy,filters:[...view.query.filters,...view.rowRules,...candidate.filters],...candidate.fiscal?{fiscal:candidate.fiscal}:{}})
 const context=await queryContext(env,query,actor.id),sources=await readSources(env,query)
 context.guards=[...context.guards??[],modelGuard(model)]
 context.exploration={modelId:model.id,viewId:view.id,revision:model.production,parameters:input}
 return {...prepareQuery(query,context,sources),sources,input:input as SubjectInput}
}
