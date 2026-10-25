import { qualityState } from '../quality/server'
import { boardDocument, readBoard, saveBoard } from '../dashboards/store.server'
import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { ownerIdentity, readQuery, readSources, saveQuery } from '../data/snapshots/store'
import { compareSnapshots } from '../reconciliation/compare'
import { queryInput } from './validate'
import { queryContext } from './context'
import { execute } from './execute'
import { fail, QueryError } from './types'
import { retainedExportResponse } from './exports.server'
import { dashboardRefreshResponse } from '../dashboards/tv.server'
import { dashboardTvExportResponse } from '../dashboards/tv-export.server'
import { dashboardAuthoringResponse } from '../dashboards/authoring.server'
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
const json = (body: unknown,status=200) => Response.json(body,{status,headers})
const resourceId = /^[a-f0-9-]{36}$/
async function body(request: Request): Promise<Record<string,unknown>> {
 if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) fail('json_body_required',400)
 const reader = request.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true}); let text = '', size = 0
 try {
  for (;;) {const part = await reader.read(); if (part.done) break; size += part.value.length; if (size>32768) fail('query_too_large',413); text+=decoder.decode(part.value,{stream:true})}
  text+=decoder.decode(); const parsed = JSON.parse(text)
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) fail('json_object_required',400)
  return parsed
 } catch(error) { if (error instanceof QueryError) throw error; fail('invalid_json',400) }
 finally {await reader.cancel();reader.releaseLock()}
}
/** Native owner-only transport; every answer and artifact is fenced by D1 auth. */
export async function exactQueryResponse(request: Request, original: Bindings): Promise<Response|null> {
 const url = new URL(request.url), path = url.pathname
 if (!/^\/api\/operator\/(queries|dashboards|dashboard-authoring|reports|reconciliations)(\/|$)/.test(path)) return null
 const env=runtimeBindings(original)
 try {
  const authority=await fileOwner(request,env)
  if (!authority) { await discard(request); return json({error:'owner_required'},401) }
  const ownerId=await ownerIdentity(env,authority)
  if (url.search) fail('query_parameters_not_supported',400)
  const authored=await dashboardAuthoringResponse(request,env,{...authority,id:ownerId,role:'owner'})
  if(authored)return authored
  const liveExport=await dashboardTvExportResponse(request,env,authority,ownerId)
  if(liveExport)return liveExport
  const refreshed=await dashboardRefreshResponse(request,env,authority,ownerId)
  if(refreshed)return refreshed
  const exported=await retainedExportResponse(request,env,authority,ownerId)
  if(exported)return exported
  if (path==='/api/operator/queries/run') {
   if (request.method!=='POST') return json({error:'method_not_allowed'},405)
   const definition=queryInput(await body(request)), context=await queryContext(env,definition,ownerId), sources=await readSources(env,definition)
   return json(await saveQuery(env,authority,definition,context,sources),201)
  }
  if (path==='/api/operator/queries') {
   if (request.method!=='GET') return json({error:'method_not_allowed'},405)
   const result=(await env.DB.prepare('SELECT id,digest,created_at,query_json FROM bf_query_snapshots WHERE owner_id=? ORDER BY created_at DESC LIMIT 50').bind(ownerId).all()).results
   await transact(env.DB,authority,[])
   return json({queries:result.map(row=>{const definition=JSON.parse(String(row.query_json));const {query_json,...metadata}=row;return {...metadata,label:definition.dataset+' · '+definition.measures.map((m:{id:string})=>m.id).join(', ')}})})
  }
  const query=/^\/api\/operator\/queries\/([^/]+)(\/rerun)?$/.exec(path)
  if (query) {
   if (!resourceId.test(query[1])) fail('snapshot_not_found',404)
   if (request.method!==(query[2]?'POST':'GET')) return json({error:'method_not_allowed'},405)
   if (query[2]) {const supplied=await body(request);if(Object.keys(supplied).length) fail('snapshot_scope_immutable',403)}
   const {snapshot,sources,guard}=await readQuery(env,authority,ownerId,query[1])
   if (query[2]) {
    const answer=execute(snapshot.definition,sources,snapshot.context)
    if(canonicalJson(answer)!==canonicalJson(snapshot.answer)) fail('snapshot_reproduction_failed',409)
    await transact(env.DB,authority,[assertion(guard)])
    return json({...snapshot,reproduced:true})
   }
   return json({...snapshot,quality:await qualityState(env,sources.map(s=>s.id))})
  }
  const artifact=/^\/api\/operator\/(dashboards|reports)(?:\/([^/]+))?$/.exec(path)
  if (artifact) {
   const kind=artifact[1]==='dashboards'?'dashboard':'report'
   if(!artifact[2]) {
    if(request.method!=='POST') return json({error:'method_not_allowed'},405)
    const input=await body(request)
    if(input.queryIds !== undefined)return json(boardDocument(await saveBoard(env,authority,ownerId,kind,input)),201)
    if(Object.keys(input).some(k=>!['queryId','title'].includes(k)) || typeof input.queryId!=='string' || !resourceId.test(input.queryId) || typeof input.title!=='string' || !input.title.trim() || input.title.length>160) fail('artifact_query_and_title_required',400)
    const {snapshot,guard}=await readQuery(env,authority,ownerId,input.queryId),id=randomUUID(),createdAt=new Date().toISOString()
    await transact(env.DB,authority,[assertion(guard),sql('INSERT INTO bf_query_artifacts(id,kind,snapshot_id,title,owner_id,created_at) VALUES(?,?,?,?,?,?)',id,kind,snapshot.snapshotId,input.title,ownerId,createdAt)])
    return json({id,kind,title:input.title,artifactCreatedAt:createdAt,...snapshot},201)
   }
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   if(!resourceId.test(artifact[2]))fail('artifact_not_found',404)
   const board=await readBoard(env,authority,ownerId,artifact[2],kind)
   if(board)return json(boardDocument(board))
   const row=await env.DB.prepare('SELECT * FROM bf_query_artifacts WHERE id=? AND kind=? AND owner_id=?').bind(artifact[2],kind,ownerId).first<{id:string;kind:string;snapshot_id:string;title:string;created_at:string}>()
   if(!row)fail('artifact_not_found',404)
   const {snapshot,guard}=await readQuery(env,authority,ownerId,row.snapshot_id)
   await transact(env.DB,authority,[assertion(guard),assertion(sql('EXISTS(SELECT 1 FROM bf_query_artifacts WHERE id=? AND kind=? AND owner_id=? AND snapshot_id=?)',row.id,kind,ownerId,row.snapshot_id))])
   return json({id:row.id,kind,title:row.title,artifactCreatedAt:row.created_at,...snapshot,quality:await qualityState(env,snapshot.answer.sourceWatermarks.map(s=>s.dataset))})
  }
  if(path==='/api/operator/reconciliations') {
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await body(request)
   if(Object.keys(input).some(k=>!['leftQueryId','rightQueryId'].includes(k)) || typeof input.leftQueryId!=='string' || typeof input.rightQueryId!=='string')fail('query_pair_required',400)
   const left=await readQuery(env,authority,ownerId,input.leftQueryId),right=await readQuery(env,authority,ownerId,input.rightQueryId)
   await transact(env.DB,authority,[assertion(left.guard),assertion(right.guard)])
   return json(compareSnapshots(left.snapshot,right.snapshot))
  }
  return json({error:'not_found'},404)
 }catch(error){
  if(error instanceof QueryError)return json({error:error.code},error.status)
  return json({error:'query_conflict',reason:'The session, retained source or conventions changed, or the exact query could not be verified. No partial answer was saved.'},409)
 }
}

/** Drain a bounded denied request so streamed native transports can finish. */
async function discard(request: Request): Promise<void> {
 if (!request.body) return
 const reader=request.body.getReader(); let size=0
 try {for (;;) {const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32768){await reader.cancel();break}}} catch {} finally {reader.releaseLock()}
}
