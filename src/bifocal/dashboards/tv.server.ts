import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { readQuery, readSources, sourceMatch } from '../data/snapshots/store'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, QueryError, type Answer, type Context, type Query } from '../query/types'
import { refreshBindings, sameRefreshConventions } from './tv-bindings.server'

type Owner=Parameters<typeof readQuery>[1]
type Card={id:string;title:string;status:'fresh'|'stale'|'empty'|'failed';answer?:Answer;context?:Omit<Context,'guards'>;definition?:Query;watermarks?:unknown[];observedAt?:string;error?:string;withdraw?:boolean;freshness?:'fresh'|'stale'}
type Manifest={id:string;title:string;refs:{snapshot_id:string;position:number}[];guards:D1Sql[]}

/** Read immutable board membership without requiring every tile to compile. */
export async function readManifest(env:Bindings,ownerId:string,id:string):Promise<Manifest|null> {
 const board=await env.DB.prepare("SELECT title,created_at FROM bf_analytics_boards WHERE id=? AND owner_id=? AND kind='dashboard'").bind(id,ownerId).first<{title:string;created_at:string}>()
 if(board) {
  const refs=(await env.DB.prepare('SELECT snapshot_id,position FROM bf_analytics_cards WHERE board_id=? ORDER BY position').bind(id).all<{snapshot_id:string;position:number}>()).results
  if(refs.length<2||refs.length>4)fail('dashboard_custody_conflict',409)
  return {id,title:board.title,refs,guards:[sql("EXISTS(SELECT 1 FROM bf_analytics_boards WHERE id=? AND owner_id=? AND kind='dashboard' AND title=? AND created_at=?)",id,ownerId,board.title,board.created_at),sql('(SELECT count(*) FROM bf_analytics_cards WHERE board_id=?)=?',id,refs.length),...refs.map(ref=>sql('EXISTS(SELECT 1 FROM bf_analytics_cards WHERE board_id=? AND position=? AND snapshot_id=?)',id,ref.position,ref.snapshot_id))]}
 }
 const artifact=await env.DB.prepare("SELECT snapshot_id,title,created_at FROM bf_query_artifacts WHERE id=? AND owner_id=? AND kind='dashboard'").bind(id,ownerId).first<{snapshot_id:string;title:string;created_at:string}>()
 return artifact?{id,title:artifact.title,refs:[{snapshot_id:artifact.snapshot_id,position:0}],guards:[sql("EXISTS(SELECT 1 FROM bf_query_artifacts WHERE id=? AND owner_id=? AND kind='dashboard' AND snapshot_id=? AND title=? AND created_at=?)",id,ownerId,artifact.snapshot_id,artifact.title,artifact.created_at)]}:null
}
const withdrawErrors=new Set(['snapshot_not_found','snapshot_integrity_failed','dataset_not_found','model_not_found','published_model_changed','native_model_revision_unavailable','metric_not_found','current_published_metric_required','dashboard_owner_scope_required','dashboard_conventions_changed','dashboard_custody_conflict'])

/** Owner admission is the existing exact-query transport's responsibility. Each
 * tile executes real current sources; no snapshots or business rows are saved. */
export async function dashboardRefreshResponse(request:Request,env:Bindings,owner:Owner,ownerId:string):Promise<Response|null> {
 const match=/^\/api\/operator\/dashboards\/([a-f0-9-]{36})\/refresh$/.exec(new URL(request.url).pathname)
 if(!match)return null
 try {
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['maxAgeSeconds'])
  if(!Number.isSafeInteger(input.maxAgeSeconds)||Number(input.maxAgeSeconds)<1||Number(input.maxAgeSeconds)>31536000)fail('dashboard_max_age_required',400)
  const manifest=await readManifest(env,ownerId,match[1])
  if(!manifest){await transact(env.DB,owner,[]);return json({error:'dashboard_withdrawn',withdraw:true},404)}
  const guards=[...manifest.guards],cards:Card[]=[]
  for(const ref of manifest.refs) {
   let title='Unavailable query'
   try {
    const retained=await readQuery(env,owner,ownerId,ref.snapshot_id),snapshot=retained.snapshot
    title=snapshot.definition.dataset;guards.push(retained.guard)
    guards.push(...await refreshBindings(env,ownerId,snapshot))
    const current=await queryContext(env,snapshot.definition,ownerId)
    guards.push(...current.guards??[])
    if(!sameRefreshConventions(snapshot.context,current))fail('dashboard_conventions_changed',409)
    const sources=await readSources(env,snapshot.definition)
    guards.push(...sources.map(sourceMatch))
    const observed=sources.map(source=>({id:source.id,at:source.table.source.lineage?.observedAt??source.table.updatedAt}))
    const now=Date.now()
    if(observed.some(source=>!Number.isFinite(Date.parse(source.at))||Date.parse(source.at)>now))fail('source_observation_time_unavailable',409)
    const oldest=Math.min(...observed.map(source=>Date.parse(source.at))),stale=now-oldest>Number(input.maxAgeSeconds)*1000
    const answer=execute(snapshot.definition,sources,current),{guards:privateGuards,...context}=current
    // Recheck imported-source provenance as well as its frozen conventions.
    if(canonicalJson(snapshot.context.modelImport??null)!==canonicalJson(current.modelImport??null))fail('published_model_changed',409)
    cards.push({id:ref.snapshot_id,title,status:answer.filteredRows===0?'empty':stale?'stale':'fresh',freshness:stale?'stale':'fresh',answer,context,definition:snapshot.definition,watermarks:answer.sourceWatermarks.map(watermark=>({...watermark,observedAt:observed.find(source=>source.id===watermark.dataset)!.at})),observedAt:new Date(oldest).toISOString()})
   }catch(error) {
    const code=error instanceof QueryError?error.code:'dashboard_tile_refresh_unavailable'
    cards.push({id:ref.snapshot_id,title,status:'failed',error:code,withdraw:withdrawErrors.has(code)})
   }
  }
  await transact(env.DB,owner,guards.map(assertion))
  const refreshedAt=new Date().toISOString()
  for(const card of cards)if(card.status!=='failed'&&card.observedAt){const stale=Date.parse(refreshedAt)-Date.parse(card.observedAt)>Number(input.maxAgeSeconds)*1000;card.freshness=stale?'stale':'fresh';if(card.status!=='empty')card.status=stale?'stale':'fresh'}
  return json({id:manifest.id,title:manifest.title,refreshedAt,cards})
 }catch(error) {
  if(error instanceof QueryError)return json({error:error.code,...error.status===404||withdrawErrors.has(error.code)?{withdraw:true}:{}},error.status)
  // Failed response-boundary authority or custody assertions disclose no new
  // tile values. The browser must clear copies whose authority is uncertain.
  return json({error:'dashboard_refresh_conflict',withdraw:true},409)
 }finally{await discardBody(request)}
}
