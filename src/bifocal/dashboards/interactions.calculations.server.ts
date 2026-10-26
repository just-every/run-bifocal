import type {Bindings} from '../../auth.server'
import {canonicalJson} from '../../modules/import-kit/src/provenance/identity.ts'
import {readCalculationLibrary,libraryGuard} from '../calculations/library/store.server'
import {calculationScope} from '../calculations/library/governance.server'
import {compileLibrary} from '../calculations/library/compile'
import {runLibrary} from '../calculations/library/run'
import type {InputRow} from '../calculations/core'
import {execute} from '../query/execute'
import {fail,type Query,type Context,type Source,type Filter} from '../query/types'
import type {DashboardInteractions,ReaderSelection} from './interactions.protocol'

/** A scenario evaluates the real calculation engine over this card's protected
 * rows. A calculation may remove reader filters, never retained or audience rules. */
export async function dashboardScenario(env:Bindings,ownerId:string,binding:DashboardInteractions['whatIfParameters'][number],selection:ReaderSelection,query:Query,context:Context,sources:Source[],readerFilters:Filter[],columns:string[]|null){
 const stored=await readCalculationLibrary(env,ownerId,binding.libraryId)
 if(stored.revision!==binding.revision)fail('dashboard_calculation_revision_changed',409)
 const input=stored.value.input,scope=await calculationScope(env,ownerId,input.modelId,input.viewId)
 if(query.context.modelVersion!==scope.model.production||query.dataset!==scope.query.dataset||canonicalJson(query.joins)!==canonicalJson(scope.query.joins))fail('dashboard_calculation_view_mismatch',409)
 if(columns&&Object.keys(scope.schema).some(column=>!columns.includes(column)))fail('dashboard_calculation_column_not_permitted',403)
 const rows:InputRow[]=[]
 execute(query,sources,context,(authorized,resolve)=>{for(const row of authorized)rows.push(Object.fromEntries(Object.keys(scope.schema).map(field=>[field,row[resolve(field)]??null])))})
 const scoped={...scope,rows,context},library=compileLibrary(input,input.id,ownerId,scoped)
 if(!library.report.compatible||!library.input.parameters.some(p=>p.id===binding.parameter))fail('dashboard_calculation_parameter_unavailable',409)
 const answer=runLibrary(library,scoped,{parameters:{[binding.parameter]:{kind:'literal',type:'number',value:selection.whatIf[binding.id]}},groupBy:query.groupBy,filters:readerFilters.map(f=>({field:f.column,op:f.op,...f.value===undefined?{}:{value:f.value}}))})
 return {answer,binding:{libraryId:stored.id,revision:stored.revision,parameter:binding.parameter,value:selection.whatIf[binding.id]},guards:[libraryGuard(stored),...scope.guards]}
}
