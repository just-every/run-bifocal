import { queryInput } from '../query/validate'
import { fail,type Filter } from '../query/types'
import { periodFilters } from './period'
import type { CalendarDefinition } from '../calendars/fiscal'
import type { QuestionPlan } from './planning'
import type { QuestionScope } from './scope.server'
export function questionQuery(scope:QuestionScope,plan:QuestionPlan,comparison=false){
 const dimensions=scope.query.semantic!.dimensions,allowed=new Set(dimensions.map(d=>d.column)),dateColumns=new Set(dimensions.filter(d=>d.type==='date').map(d=>d.column))
 if(plan.groupBy.some(d=>!allowed.has(d))||plan.filters.some(f=>!allowed.has(f.column))||plan.drivers.some(d=>!allowed.has(d)))fail('question_field_not_permitted',403)
 const measures=plan.measureIds.map(id=>{const measure=scope.query.measures.find(m=>m.id===id);if(!measure)fail('question_metric_not_permitted',403);return measure})
 if(!measures.length)fail('question_metric_required',422)
 const filters:Filter[]=plan.filters.map(f=>{
  const type=dimensions.find(d=>d.column===f.column)!.type,typed=(value:string)=>type==='boolean'?value==='true'?true:value==='false'?false:fail('question_boolean_required',422):value
  return {column:f.column,op:f.op,value:f.op==='in'?f.values.map(typed):typed(f.value)}
 })
 const period=comparison?plan.comparison:plan.period
 if(!period)fail('question_comparison_required',422)
 const dates=periodFilters(period,scope.context.calendar.definition as unknown as CalendarDefinition,dateColumns)
 const query=queryInput({...scope.query,filters:[...scope.query.filters,...filters,...dates.filters],groupBy:plan.groupBy,measures})
 return {query,interpretation:{groupBy:plan.groupBy,measureIds:plan.measureIds,filters,period:dates.interpretation},dates}
}
