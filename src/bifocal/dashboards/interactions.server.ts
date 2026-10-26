import {dashboardSourceRecords} from './interactions.records.server'
import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {assertion,transact} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {prepareQuery,readSources,sourceMatch} from '../data/snapshots/store'
import {queryContext} from '../query/context'
import {discardBody,exactKeys,json,jsonBody} from '../models/validation/transport'
import {fail,QueryError} from '../query/types'
import {runPublishedDashboard} from './interactions.run.server'
import {prepareDashboardAction,prepareDashboardContext,readDashboardContext,readReaderBookmarks,prepareReaderBookmark} from './interactions.state.server'
import {prepareDashboardDefinition,applyDashboardDefinition} from './authoring.prepare.server'

/** Owner native door. Audience callers use the guarded execution bridge rather
 * than borrowing this transport or the owner's retained-answer export routes. */
export async function dashboardInteractionsResponse(request:Request,env:Bindings,actor:Authority):Promise<Response|null>{
 const path=new URL(request.url).pathname,match=/^\/api\/operator\/dashboard-authoring\/([a-f0-9-]{36})\/(run|reader-bookmarks(?:\/([^/]+)\/(\d+))?|action|duplicate\/review|duplicate\/apply|current-export|source-records)$/.exec(path)
 if(!match)return null
 try{
  if(actor.role!=='owner')fail('owner_required',403)
  const bookmarkRead=match[2].startsWith('reader-bookmarks')&&request.method==='GET'
  if(!bookmarkRead&&request.method!=='POST')fail('method_not_allowed',405)
  const input=bookmarkRead?{}:await jsonBody(request),context=await readDashboardContext(env,actor,actor.id,match[1],input.contextId),run=await runPublishedDashboard(env,actor,actor.id,match[1],input.selection,undefined,context?.inherited)
  if(context&&context.targetRevision!==run.result.revision)fail('dashboard_context_target_changed',409)
  const fences=[...run.guards,...context?.guards??[]]
  if(match[2]==='run'){exactKeys(input,['selection','contextId']);await transact(env.DB,actor,fences.map(assertion));return json(run.result)}
  if(bookmarkRead){const result=await readReaderBookmarks(env,actor,run,match[3]?decodeURIComponent(match[3]):undefined,match[4]?Number(match[4]):undefined);await transact(env.DB,actor,fences.map(assertion));return json(result)}
  if(match[2]==='reader-bookmarks'){const prepared=await prepareReaderBookmark(env,actor,run,input);await transact(env.DB,actor,[...fences.map(assertion),...prepared.guards.map(assertion),...prepared.changes]);return json(prepared.result,201)}
  if(match[2]==='source-records'){exactKeys(input,['selection','contextId','actionId','record','offset']);const records=await dashboardSourceRecords(env,actor,actor.id,run,input.actionId,input.record,input.offset);await transact(env.DB,actor,[...records.guards,...context?.guards??[]].map(assertion));return json(records.result)}
  if(match[2]==='action'){
   exactKeys(input,['selection','contextId','actionId'])
   const prepared=await prepareDashboardAction(env,actor,actor.id,run,input.actionId),targetRun=await runPublishedDashboard(env,actor,actor.id,prepared.target.state.id,{},undefined,prepared.inherited)
   if(prepared.action.kind==='tooltip'){await transact(env.DB,actor,[...fences,...prepared.guards,...targetRun.guards].map(assertion));return json({kind:'tooltip',...targetRun.result})}
   const context=await prepareDashboardContext(env,actor,prepared,run);await transact(env.DB,actor,[...[...fences,...prepared.guards,...targetRun.guards].map(assertion),...context.changes]);return json({kind:'dashboard',...context.result},201)
  }
  if(match[2].startsWith('duplicate/')){
   exactKeys(input,['title','reviewedDigest']);if(!run.result.config.duplicateAllowed)fail('dashboard_duplication_not_permitted',403)
   if(typeof input.title!=='string'||!input.title.trim()||input.title.length>160)fail('dashboard_duplicate_title_required',400)
   // Reuse actual draft review and apply. No source grant, personal state or
   // publication pointer is copied, and the duplicate starts unpublished.
   const document={...run.result.document,title:input.title},prepared=await prepareDashboardDefinition(env,actor,document,undefined,undefined),digest=sha256(canonicalJson({source:run.result.id,revision:run.result.revision,review:prepared.review.digest}))
   if(match[2]==='duplicate'+'/review'){await transact(env.DB,actor,[...fences,...prepared.guards].map(assertion));return json({digest,title:document.title,source:run.result.id,revision:run.result.revision})}
   if(input.reviewedDigest!==digest)fail('exact_dashboard_duplicate_review_required',409)
   const saved=await applyDashboardDefinition(env,actor,{document,reviewedDigest:prepared.review.digest},fences)
   return json(saved,201)
  }
  exactKeys(input,['selection','contextId','card','definitionHash','watermarks'])
  const card=run.result.cards.find(card=>card.key===input.card)
  if(!card||!('answer' in card)||!card.answer||!('definition' in card)||!card.definition||!('context' in card)||!card.context)fail('dashboard_current_export_unavailable',409)
  if(card.answer.definitionHash!==input.definitionHash||canonicalJson(card.answer.sourceWatermarks)!==canonicalJson(input.watermarks))fail('dashboard_displayed_result_changed',409)
  const sources=await readSources(env,card.definition),ctx=await queryContext(env,card.definition,actor.id),prepared=prepareQuery(card.definition,ctx,sources)
  if(canonicalJson(prepared.snapshot.answer)!==canonicalJson(card.answer))fail('dashboard_displayed_result_changed',409)
  await transact(env.DB,actor,[...fences.map(assertion),...(ctx.guards??[]).map(assertion),...sources.map(sourceMatch).map(assertion),...prepared.changes]);return json({queryId:prepared.snapshot.snapshotId,answer:prepared.snapshot.answer},201)
 }catch(error){return error instanceof QueryError?json({error:error.code,withdraw:[401,403,404].includes(error.status)},error.status):json({error:'dashboard_interaction_conflict',withdraw:true},409)}finally{await discardBody(request)}
}
