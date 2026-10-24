import type { Bindings } from '../../auth.server'
import { readSources,sourceMatch } from '../data/snapshots/store'
import { readModel,readDefinition,modelGuard } from '../models/validation/store.server'
import { scopedQuery } from '../models/validation/protocol'
import { queryContext } from '../query/context'
import { fail } from '../query/types'
export async function questionScope(env:Bindings,ownerId:string,modelId:string,revision:string,viewId:string){
 const model=await readModel(env,ownerId,modelId)
 if(model.production!==revision)fail('published_model_changed',409)
 const definition=await readDefinition(env,revision),view=definition.views.find(v=>v.id===viewId)
 if(!view?.query.semantic)fail('governed_question_view_required',404)
 const query=scopedQuery(view,revision),context=await queryContext(env,query,ownerId),sources=await readSources(env,query)
 context.guards=[modelGuard(model),...context.guards??[]]
 return {model,view,query,context,sources,guards:[...context.guards,...sources.map(sourceMatch)]}
}
export type QuestionScope=Awaited<ReturnType<typeof questionScope>>
