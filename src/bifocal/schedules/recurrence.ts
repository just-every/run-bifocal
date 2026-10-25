import { addDays, dayNumber, monthDate, weekday } from '../calendars/date'
import { resolveSchedule } from '../calendars/timezone'
import { requireValue } from '../company/protocol'
import type { RecurringDocument } from './protocol'

/** Civil days form the iteration axis. UTC is never the recurring wall clock.
 * Daily intervals start at startDate; weekly intervals use its Monday week;
 * monthly intervals use its calendar month. The declared end date is inclusive. */
export function resolveRecurrence(document:RecurringDocument) {
 const definition=document.definition,{startDate,endDate,recurrence}=definition
 const start=dayNumber(startDate),firstWeek=start-((weekday(startDate)+6)%7),firstMonth=Number(startDate.slice(0,4))*12+Number(startDate.slice(5,7))-1
 const occurrences:{localDate:string;status:ReturnType<typeof resolveSchedule>['status'];instants:ReturnType<typeof resolveSchedule>['instants'];shiftSeconds:number}[]=[]
 let instantCount=0
 for(let localDate=startDate;localDate<=endDate;localDate=addDays(localDate,1)) {
  let included=false
  if(recurrence.frequency==='daily')included=(dayNumber(localDate)-start)%recurrence.interval===0
  else if(recurrence.frequency==='weekly')included=Math.floor((dayNumber(localDate)-firstWeek)/7)%recurrence.interval===0&&recurrence.weekdays.includes(weekday(localDate))
  else {
   const year=Number(localDate.slice(0,4)),month=Number(localDate.slice(5,7)),offset=year*12+month-1-firstMonth
   const candidate=monthDate(year,month,recurrence.day)
   included=offset%recurrence.interval===0&&localDate===candidate&&(Number(candidate.slice(8,10))===recurrence.day||recurrence.missingDay==='last-day')
  }
  if(!included)continue
  const resolution=resolveSchedule({...definition,localDate})
  occurrences.push({localDate,...resolution});instantCount+=resolution.instants.length
  requireValue(occurrences.length<=400&&instantCount<=400,'schedule_occurrence_limit')
 }
 requireValue(occurrences.length>0,'schedule_has_no_occurrences')
 return {range:{startDate,endDate,inclusive:true},occurrences,occurrenceCount:occurrences.length,instantCount}
}
