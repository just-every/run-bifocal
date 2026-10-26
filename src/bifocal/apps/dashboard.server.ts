import {appActions,appDashboardContext,prepareAppContext,type Inherited} from './dashboard-context.server'
import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {assertion,transact} from '../../modules/import-kit/src/door/store.ts'
import {fail} from '../query/types'
import {exactKeys,json,jsonBody} from '../models/validation/transport'
import {runPublishedDashboard} from '../dashboards/interactions.run.server'
import {readReaderBookmarks,prepareReaderBookmark} from '../dashboards/interactions.state.server'
import {defaultInteractions} from '../dashboards/interactions.protocol'
import {member} from './reader.server'
import {entitlementGuard,audit} from './store.server'

/** The app grants summary reading only. Source definitions, context and owner
 * transport capabilities never enter the audience reader response. */
function summary(run:Awaited<ReturnType<typeof runPublishedDashboard>>,title:string) {
 const result=run.result
 return {id:result.id,title,revision:result.revision,selection:result.selection,inherited:result.inherited,refreshedAt:result.refreshedAt,cards:result.cards.map(card=>{
  if(!('answer' in card)||!card.answer||!('definition' in card)||!card.definition||!('context' in card)||!card.context)return {key:card.key,status:'failed',error:'app_data_unavailable'}
  return {key:card.key,status:card.status,observedAt:card.observedAt,definition:{groupBy:card.definition.groupBy},context:{currency:card.context.currency},answer:{rows:card.answer.rows,totals:card.answer.totals,filteredRows:card.answer.filteredRows,definitionHash:card.answer.definitionHash,sourceWatermarks:[]},...('scenario' in card&&card.scenario?{scenario:card.scenario}:{})}
 })}
}
export async function appDashboardResponse(request:Request,env:Bindings,actor:Authority,appId:string,audienceKey:string,pageKey:string,action:string) {
 const app=await member(env,actor,appId),audience=app.document.audiences.find(a=>a.key===audienceKey&&app.audiences.includes(a.key)),page=app.document.pages.find(p=>p.key===pageKey),pin=page?.frozen?.dashboard
 if(!audience||!page||!audience.pages.includes(pageKey)||!pin)fail('app_page_not_found',404)
 const isRead=request.method==='GET',input=isRead?{}:await jsonBody(request),scope='app:'+appId+':'+audienceKey+':'+pageKey+':'+app.version
 if(action==='resource') {
  if(!isRead)fail('method_not_allowed',405)
  await transact(env.DB,actor,[assertion(entitlementGuard(actor,appId,audienceKey,app.version,app.digest))])
  const document=pin.document,config=document.interactions??defaultInteractions(document)
  return json({id:pin.id,published:{revision:pin.revision,document:{title:page.title,cards:document.cards.map(c=>({key:c.key})),layout:document.layout,interactions:{...config,actions:appActions(app,audienceKey,page),recordActions:[],duplicateAllowed:false}}}})
 }
 if(action==='run')exactKeys(input,['selection','contextId'])
 if(action==='action')exactKeys(input,['selection','contextId','actionId'])
 // Drillthrough is only admitted through an app-aware target; native context
 // tokens cannot borrow an owner's target dashboard authority.
 const context=await appDashboardContext(env,actor,app,audienceKey,pageKey,input.contextId)
 const run=await runPublishedDashboard(env,actor,app.ownerId,pin.id,input.selection,{rows:audience.rows,columns:audience.columns},context.inherited,pin.revision),guards=[...context.guards,entitlementGuard(actor,appId,audienceKey,app.version,app.digest),...run.guards]
 if(action==='run') {
  if(isRead)fail('method_not_allowed',405)
  await transact(env.DB,actor,[...guards.map(assertion),audit(actor,{id:appId,owner_id:app.ownerId},'dashboard-read',audienceKey+':'+pageKey,app.version,app.digest)])
  return json(summary(run,page.title))
 }
 if(action==='action') {
  if(isRead||run.result.cards.some(card=>card.status==='failed'))fail('app_action_unavailable',404)
  const selected=appActions(app,audienceKey,page).find(action=>action.id===input.actionId),target=selected&&app.document.pages.find(target=>audience.pages.includes(target.key)&&target.frozen?.dashboard?.id===selected.target)
  if(!selected||!target?.frozen?.dashboard)fail('app_action_unavailable',404)
  const targetPin=target.frozen.dashboard,config=targetPin.document.interactions??defaultInteractions(targetPin.document),inherited:Inherited={filters:[],fiscal:{}}
  for(const binding of selected.bindings){const matches=[...run.result.inherited.filters,...run.result.selection.filters].filter(filter=>filter.column===binding.source);if(!matches.length||!config.dimensions.includes(binding.target))fail('app_named_context_required',400);for(const filter of matches)inherited.filters.push({...filter,column:binding.target})}
  for(const binding of selected.fiscalBindings){const period=run.result.inherited.fiscal[binding.source]??run.result.selection.fiscal[binding.source];if(!period||!config.fiscalParameters.some(parameter=>parameter.id===binding.target))fail('app_named_context_required',400);inherited.fiscal[binding.target]=period}
  const targetRun=await runPublishedDashboard(env,actor,app.ownerId,targetPin.id,{}, {rows:audience.rows,columns:audience.columns},inherited,targetPin.revision)
  if(targetRun.result.cards.some(card=>card.status==='failed'))fail('app_action_unavailable',404)
  if(selected.kind==='tooltip'){await transact(env.DB,actor,[...guards,...targetRun.guards].map(assertion));return json({kind:'tooltip',...summary(targetRun,target.title)})}
  const prepared=prepareAppContext(actor,app,audienceKey,pageKey,target.key,inherited)
  await transact(env.DB,actor,[...[...guards,...targetRun.guards].map(assertion),...prepared.changes])
  return json(prepared.result,201)
 }
 const bookmark=/^reader-bookmarks(?:\/([^/]+)\/(\d+))?$/.exec(action)
 if(!bookmark)fail('app_dashboard_action_not_permitted',403)
 if(isRead){const result=await readReaderBookmarks(env,actor,run,bookmark[1]?decodeURIComponent(bookmark[1]):undefined,bookmark[2]?Number(bookmark[2]):undefined,scope);await transact(env.DB,actor,guards.map(assertion));return json(result)}
 if(bookmark[1])fail('method_not_allowed',405)
 const prepared=await prepareReaderBookmark(env,actor,run,input,scope)
 await transact(env.DB,actor,[...[...guards,...prepared.guards].map(assertion),...prepared.changes])
 return json(prepared.result,201)
}
