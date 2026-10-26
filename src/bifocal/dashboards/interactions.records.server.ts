import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {readSources,sourceMatch} from '../data/snapshots/store'
import {queryInput} from '../query/validate'
import {queryContext} from '../query/context'
import {execute} from '../query/execute'
import {fail,type Cell} from '../query/types'
import {interactionObject} from './interactions.protocol'
import type {runPublishedDashboard} from './interactions.run.server'

type Run=Awaited<ReturnType<typeof runPublishedDashboard>>
/** Explicit underlying-record authority is the receiving door's responsibility.
 * This helper narrows the already guarded current card, including inherited
 * region and period and audience rows; it never borrows authority from a bookmark. */
export async function dashboardSourceRecords(env:Bindings,actor:Authority,ownerId:string,run:Run,actionId:unknown,record:unknown,offset:unknown=0,allowedColumns:string[]|null=null){
 const action=run.result.config.recordActions.find(a=>a.id===actionId),card=action?run.result.cards.find(c=>c.key===action.card):null
 if(!action||!card||!('definition' in card)||!card.definition||!('answer' in card)||!card.answer)fail('dashboard_source_records_unavailable',403)
 if(allowedColumns&&action.columns.some(column=>!allowedColumns.includes(column)))fail('dashboard_source_record_column_not_permitted',403)
 if(!Number.isSafeInteger(offset)||Number(offset)<0)fail('dashboard_source_record_offset_required',400)
 const namedRecord=record===undefined?null:interactionObject(record)
 if(namedRecord&&(Object.keys(namedRecord).length!==action.keys.length||action.keys.some(key=>!Object.hasOwn(namedRecord,key))||Object.entries(namedRecord).some(([key,value])=>!action.keys.includes(key)||!(value===null||typeof value==='string'&&value.length<=4096||typeof value==='boolean'))))fail('exact_dashboard_record_key_required',400)
 const definition=queryInput({...card.definition,filters:[...card.definition.filters,...namedRecord?Object.entries(namedRecord).map(([column,value])=>({column,op:'eq',value})):[]]}),sources=await readSources(env,definition),context=await queryContext(env,definition,ownerId),rows:Record<string,Cell>[]=[]
 execute(definition,sources,context,(authorized,resolve)=>{for(const row of authorized)rows.push(Object.fromEntries(action.columns.map(column=>[column,row[resolve(column)]??null])))})
 if(namedRecord&&rows.length!==1)fail(rows.length?'dashboard_source_record_grain_changed':'dashboard_source_record_not_found',rows.length?409:404)
 const base=sources.find(source=>source.id===definition.dataset)!,start=Number(offset)
 if(start>rows.length)fail('dashboard_source_record_page_unavailable',400)
 return {result:{actionId:action.id,title:action.label,card:action.card,dataset:base.id,sourceRevision:base.revision,columns:action.columns,keys:action.keys,rows:rows.slice(start,start+25),totalRows:rows.length,offset:start,nextOffset:start+25<rows.length?start+25:null,record:namedRecord,selection:run.result.selection,inherited:run.result.inherited,sourceWatermarks:card.answer.sourceWatermarks},guards:[...run.guards,...context.guards??[],...sources.map(sourceMatch)]}
}
