import { date } from '../calendars/date'
import { queryInput } from '../query/validate'
import { fail } from '../query/types'
import type { PlannerInput } from './planning'
import type { QuestionScope } from './scope.server'
export type QuestionRequest={modelId:string;revision:string;viewId:string;question:string;asOf:string;context:PlannerInput['context']}
export function requestInput(input:Record<string,unknown>):QuestionRequest{
 for(const key of ['modelId','revision','viewId','question','asOf'])if(typeof input[key]!=='string')fail('question_binding_required',400)
 if(String(input.question).trim().length<1||String(input.question).length>4000)fail('bounded_question_required',400)
 date(input.asOf)
 if(input.context!==null&&(!input.context||typeof input.context!=='object'||Array.isArray(input.context)))fail('explicit_question_context_required',400)
 return {modelId:String(input.modelId),revision:String(input.revision),viewId:String(input.viewId),question:String(input.question).trim(),asOf:String(input.asOf),context:input.context as PlannerInput['context']}
}
export function plannerInput(input:QuestionRequest,scope:QuestionScope):PlannerInput{
 const context=input.context,dimensions=scope.query.semantic!.dimensions
 if(context){
  if(Object.keys(context).some(k=>!['groupBy','measureIds','filters','period'].includes(k))||!Array.isArray(context.groupBy)||!Array.isArray(context.measureIds)||!Array.isArray(context.filters))fail('invalid_question_context',400)
  if(context.groupBy.some(c=>!dimensions.some(d=>d.column===c))||context.filters.some(f=>!dimensions.some(d=>d.column===f.column))||context.measureIds.some(id=>!scope.query.measures.some(m=>m.id===id)))fail('question_context_not_permitted',403)
  queryInput({...scope.query,filters:context.filters,groupBy:context.groupBy,measures:context.measureIds.length?context.measureIds.map(id=>scope.query.measures.find(m=>m.id===id)!):scope.query.measures})
 }
 return {question:input.question,asOf:input.asOf,context,model:{id:scope.model.id,revision:scope.model.production!,viewId:scope.view.id,dimensions:dimensions as PlannerInput['model']['dimensions'],measures:scope.query.measures,calendar:scope.context.calendar,timezone:scope.context.timezone,immutableFilters:scope.view.query.filters,rowRules:scope.view.rowRules,fiscal:scope.query.fiscal??null}}
}
