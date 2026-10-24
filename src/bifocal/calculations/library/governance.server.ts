import type { Bindings } from '../../../auth.server'
import { readSources, sourceMatch } from '../../data/snapshots/store'
import { readModel, readDefinition, modelGuard } from '../../models/validation/store.server'
import { scopedQuery } from '../../models/validation/protocol'
import { queryContext } from '../../query/context'
import { execute } from '../../query/execute'
import { fail } from '../../query/types'
import { fiscalFilters } from '../../models/semantics'
import type { InputRow, Schema, DataType } from '../core'
export async function calculationScope(env:Bindings,ownerId:string,modelId:string,viewId:string){
 const model=await readModel(env,ownerId,modelId)
 if(!model.production)fail('published_model_required',409)
 const definition=await readDefinition(env,model.production),view=definition.views.find(v=>v.id===viewId)
 if(!view?.query.semantic)fail('governed_calculation_view_required',404)
 const query=scopedQuery(view,model.production),context=await queryContext(env,query,ownerId),sources=await readSources(env,query)
 const schema:Schema=Object.fromEntries(query.semantic!.dimensions.map(d=>[d.column,(d.type==='money'?'number':d.type) as DataType]))
 const rows:InputRow[]=[]
 execute(query,sources,context,(authorized,resolve)=>{for(const row of authorized)rows.push(Object.fromEntries(Object.keys(schema).map(field=>[field,row[resolve(field)]??null])))})
 const bounds=fiscalFilters(query,context),fiscal=query.fiscal?{dateColumn:query.fiscal.column,from:String(bounds[0].value),to:String(bounds[1].value),period:query.fiscal.window==='year-to-date'?'year' as const:'quarter' as const}:undefined
 return {model,view,query,context,schema,rows,fiscal,sources,guards:[modelGuard(model),...context.guards??[],...sources.map(sourceMatch)]}
}
export type CalculationScope=Awaited<ReturnType<typeof calculationScope>>
