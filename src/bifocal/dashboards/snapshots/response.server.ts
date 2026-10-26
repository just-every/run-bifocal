import type {Bindings} from '../../../auth.server'
import type {Authority} from '../../catalog/authority.server'
import {assertion,transact} from '../../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import {discardBody,exactKeys,json,jsonBody,privateHeaders} from '../../models/validation/transport'
import {fail,QueryError} from '../../query/types'
import {runPublishedDashboard} from '../interactions.run.server'
import {readDashboardContext} from '../interactions.state.server'
import {snapshotScene,type Run} from './scene.ts'
import {encodePdf} from './pdf.ts'
import {encodePptx} from './pptx.ts'
export function displayedSnapshotDigest(run:Run){return sha256(canonicalJson({id:run.id,revision:run.revision,selection:run.selection,inherited:run.inherited,cards:run.cards.map(({key,...card})=>({key,...card}))}))}
/** Owner transport remains guarded again after the complete binary is encoded. */
export async function dashboardSnapshotResponse(request:Request,env:Bindings,actor:Authority):Promise<Response|null>{
 const match=/^\/api\/operator\/dashboard-authoring\/([a-f0-9-]{36})\/snapshot\/(review|download)$/.exec(new URL(request.url).pathname)
 if(!match)return null
 try{
  if(actor.role!=='owner')fail('owner_required',403)
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['selection','contextId','filterState','tabs','layout','format','displayedDigest','exportedAt','reviewedDigest'])
  if(input.filterState!=='current'&&input.filterState!=='default')fail('dashboard_snapshot_filter_state_required',400)
  if(input.format!=='pdf'&&input.format!=='pptx')fail('dashboard_snapshot_format_required',400)
  if(input.layout!=='desktop'&&input.layout!=='phone')fail('dashboard_snapshot_layout_required',400)
  const context=await readDashboardContext(env,actor,actor.id,match[1],input.contextId),run=await runPublishedDashboard(env,actor,actor.id,match[1],input.filterState==='default'?{}:input.selection,undefined,context?.inherited)
  if(context&&context.targetRevision!==run.result.revision)fail('dashboard_context_target_changed',409)
  if(input.filterState==='current'&&input.displayedDigest!==displayedSnapshotDigest(run.result))fail('dashboard_displayed_result_changed',409)
  if(!Array.isArray(input.tabs)||!input.tabs.length||input.tabs.length>8||input.tabs.some(t=>typeof t!=='string'||!run.result.config.tabs.some(tab=>tab.id===t))||new Set(input.tabs).size!==input.tabs.length)fail('dashboard_snapshot_selected_tabs_required',400)
  const tabs=run.result.config.tabs.filter(t=>(input.tabs as string[]).includes(t.id)).map(t=>t.id)
  if(input.exportedAt!==undefined&&(typeof input.exportedAt!=='string'||!Number.isFinite(Date.parse(input.exportedAt))||new Date(input.exportedAt).toISOString()!==input.exportedAt||Date.parse(input.exportedAt)>Date.now()||Date.now()-Date.parse(input.exportedAt)>600000))fail('dashboard_snapshot_review_expired',409)
  if(match[2]==='download'&&typeof input.exportedAt!=='string')fail('exact_dashboard_snapshot_review_required',409)
  const snapshot=snapshotScene(run.result,{tabs,layout:input.layout,filterState:input.filterState,exportedAt:typeof input.exportedAt==='string'?input.exportedAt:new Date().toISOString(),backLink:new URL('/app/dashboard-authoring/'+match[1]+'/view',request.url).href}),digest=sha256(canonicalJson({format:input.format,snapshot,actorId:actor.id,guards:[...run.guards,...context?.guards??[]],contextId:input.contextId??null})),bytes=input.format==='pdf'?encodePdf(snapshot):encodePptx(snapshot)
  if(bytes.length>16_000_000)fail('dashboard_snapshot_size_limit',413)
  if(match[2]==='download'&&input.reviewedDigest!==digest)fail('exact_dashboard_snapshot_review_required',409)
  await transact(env.DB,actor,[...run.guards,...context?.guards??[]].map(assertion))
  if(match[2]==='review')return json({digest,format:input.format,bytes:bytes.length,...snapshot})
  return new Response(new Uint8Array(bytes).buffer,{headers:{...privateHeaders,'content-type':input.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation','content-disposition':'attachment; filename="dashboard-'+match[1]+'.'+input.format+'"','content-length':String(bytes.length)}})
 }catch(error){return error instanceof QueryError?json({error:error.code,withdraw:true},error.status):json({error:'dashboard_snapshot_conflict',withdraw:true},409)}finally{await discardBody(request)}
}
