import { date, monthDate, weekday, yearOf } from '../calendars/date'
import { scheduleDefinition, type ScheduleDefinition } from '../calendars/timezone'
import { ConventionsError, identifier, integer, object, requireValue } from '../company/protocol'

export type Recurrence={frequency:'daily';interval:number}|{frequency:'weekly';interval:number;weekdays:number[]}|{frequency:'monthly';interval:number;day:number;missingDay:'skip'|'last-day'}
export type Target={modelId:string;viewId:string;environment:'development'|'staging'|'production';branchId?:string}
export type RecurringDocument={version:2;id:string;definition:Omit<ScheduleDefinition,'localDate'> & {startDate:string;endDate:string;recurrence:Recurrence;target:Target}}
const uuid=(value:unknown):string=>{
 if(typeof value!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value))throw new ConventionsError('model_or_branch_uuid_required',400)
 return value
}
export function recurringDocument(value:unknown):RecurringDocument {
 const document=object(value,['version','id','definition'])
 if(document.version!==2)throw new ConventionsError('recurring_schedule_document_required',400)
 const input=object(document.definition,['name','startDate','endDate','time','timezone','reportCutoff','skipped','repeated','recurrence','target'])
 const startDate=date(input.startDate),endDate=date(input.endDate)
 requireValue(endDate>=startDate&&endDate<=monthDate(yearOf(startDate)+1,Number(startDate.slice(5,7)),Number(startDate.slice(8,10))),'schedule_requires_finite_range_within_one_year')
 const {localDate,...civil}=scheduleDefinition({name:input.name,localDate:startDate,time:input.time,timezone:input.timezone,reportCutoff:input.reportCutoff,skipped:input.skipped,repeated:input.repeated})
 const recurrence=object(input.recurrence,['frequency','interval','weekdays','day','missingDay']),interval=integer(recurrence.interval,'interval',1,1000000000)
 let normalized:Recurrence
 if(recurrence.frequency==='daily') {
  requireValue(recurrence.weekdays===undefined&&recurrence.day===undefined&&recurrence.missingDay===undefined,'daily_recurrence_fields')
  normalized={frequency:'daily',interval}
 }else if(recurrence.frequency==='weekly') {
  requireValue(recurrence.day===undefined&&recurrence.missingDay===undefined,'weekly_recurrence_fields')
  const weekdays=recurrence.weekdays===undefined?[weekday(startDate)]:recurrence.weekdays
  requireValue(Array.isArray(weekdays)&&weekdays.length>0&&weekdays.length<=7&&weekdays.every(day=>typeof day==='number'&&Number.isInteger(day)&&day>=0&&day<=6)&&new Set(weekdays).size===weekdays.length,'weekly_weekdays_required')
  normalized={frequency:'weekly',interval,weekdays:[...weekdays].sort((a,b)=>a-b)}
 }else if(recurrence.frequency==='monthly') {
  requireValue(recurrence.weekdays===undefined,'monthly_recurrence_fields')
  const day=recurrence.day===undefined?Number(startDate.slice(8,10)):integer(recurrence.day,'day',1,31),missingDay=recurrence.missingDay??'skip'
  requireValue(missingDay==='skip'||missingDay==='last-day','monthly_missing_day_policy_required')
  normalized={frequency:'monthly',interval,day,missingDay}
 }else throw new ConventionsError('recurrence_frequency_required',400)
 const rawTarget=object(input.target,['modelId','viewId','environment','branchId'])
 requireValue(['development','staging','production'].includes(String(rawTarget.environment)),'schedule_environment_required')
 const target:Target={modelId:uuid(rawTarget.modelId),viewId:identifier(rawTarget.viewId),environment:rawTarget.environment as Target['environment']}
 if(target.environment==='development')target.branchId=uuid(rawTarget.branchId)
 else requireValue(rawTarget.branchId===undefined,'branch_only_for_development')
 return {version:2,id:identifier(document.id),definition:{...civil,startDate,endDate,recurrence:normalized,target}}
}
