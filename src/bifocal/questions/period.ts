import { addDays, date, monthDate } from '../calendars/date'
import { classifyDate, fiscalYear, type CalendarDefinition } from '../calendars/fiscal'
import { fail, type Filter } from '../query/types'
import type { QuestionPeriod } from './planning'
export function periodFilters(period:QuestionPeriod,calendar:CalendarDefinition,allowed:Set<string>):{filters:Filter[];interpretation:QuestionPeriod}{
 if(period.kind==='all')return {filters:[],interpretation:period}
 if(!allowed.has(period.column))fail('question_date_not_permitted',403)
 if(period.kind==='range'){const from=date(period.from),to=date(period.to);if(from>to)fail('question_date_order',422);return {filters:[{column:period.column,op:'gte',value:from},{column:period.column,op:'lte',value:to}],interpretation:{...period,asOf:period.asOf?date(period.asOf):to,from,to}}}
 const asOf=date(period.asOf),position=classifyDate(calendar,asOf),year=fiscalYear(calendar,position.fiscalYear)
 let from:string,to:string
 if(period.kind==='quarter-to-date'){from=year.periods.find(p=>p.quarter===position.quarter)!.start;to=asOf}
 else if(period.kind==='year-to-date'){from=year.start;to=asOf}
 else if(period.kind==='last-quarter'){
  to=addDays(year.periods.find(p=>p.quarter===position.quarter)!.start,-1)
  const prior=classifyDate(calendar,to),previous=fiscalYear(calendar,prior.fiscalYear)
  from=previous.periods.find(p=>p.quarter===prior.quarter)!.start
 }else{
  const y=Number(asOf.slice(0,4)),m=Number(asOf.slice(5,7)),offset=period.kind==='last-month'?-1:0,index=y*12+m-1+offset
  from=monthDate(Math.floor(index/12),index%12+1,1);to=addDays(monthDate(Math.floor((index+1)/12),(index+1)%12+1,1),-1)
 }
 if(from>to)fail('question_date_order',422)
 return {filters:[{column:period.column,op:'gte',value:from},{column:period.column,op:'lte',value:to}],interpretation:{...period,asOf,from,to}}
}
