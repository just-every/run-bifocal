import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { readQuery } from '../data/snapshots/store'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'
import { dashboardFilters, filteredDashboardQuery } from './filters'
import { refreshBindings } from './tv-bindings.server'
import { readManifest } from './tv.server'

type Owner=Parameters<typeof readQuery>[1]
type Bookmark={name:string;revision:number;filters_json:string;created_at:string}
const document=(row:Bookmark)=>({name:row.name,revision:row.revision,filters:JSON.parse(row.filters_json),createdAt:row.created_at})
/** Personal owner state only: a bookmark never publishes or conveys a grant. */
export async function dashboardBookmarkResponse(request:Request,env:Bindings,owner:Owner,ownerId:string):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/operator\/dashboards\/([a-f0-9-]{36})\/bookmarks(?:\/([^/]+)\/(\d+))?$/.exec(url.pathname)
 if(!match)return null
 try{
  if(!['GET','POST'].includes(request.method)||match[2]&&request.method!=='GET')fail('method_not_allowed',405)
  const manifest=await readManifest(env,ownerId,match[1]);if(!manifest)fail('dashboard_withdrawn',404)
  const guards=[...manifest.guards],definitions=[]
  for(const ref of manifest.refs){const retained=await readQuery(env,owner,ownerId,ref.snapshot_id);guards.push(retained.guard,...await refreshBindings(env,ownerId,retained.snapshot));definitions.push(retained.snapshot.definition)}
  if(request.method==='GET'){
   if(match[2]){
    const name=decodeURIComponent(match[2]),revision=Number(match[3])
    const row=await env.DB.prepare('SELECT name,revision,filters_json,created_at FROM bf_dashboard_bookmarks WHERE dashboard_id=? AND owner_id=? AND name=? AND revision=?').bind(match[1],ownerId,name,revision).first<Bookmark>()
    if(!row)fail('dashboard_bookmark_not_found',404)
    await transact(env.DB,owner,guards.map(assertion));return json(document(row))
   }
   const rows=(await env.DB.prepare('SELECT b.name,b.revision,b.filters_json,b.created_at FROM bf_dashboard_bookmarks b WHERE b.dashboard_id=? AND b.owner_id=? AND b.revision=(SELECT max(v.revision) FROM bf_dashboard_bookmarks v WHERE v.dashboard_id=b.dashboard_id AND v.owner_id=b.owner_id AND v.name=b.name) ORDER BY b.name').bind(match[1],ownerId).all<Bookmark>()).results
   await transact(env.DB,owner,guards.map(assertion));return json({bookmarks:rows.map(document)})
  }
  const input=await jsonBody(request);exactKeys(input,['name','previousRevision','filters'])
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\u0000-\u001f]/.test(input.name))fail('dashboard_bookmark_name_required',400)
  const name=input.name.trim(),filters=dashboardFilters(input.filters)
  if(input.filters===undefined)fail('dashboard_bookmark_filters_required',400)
  for(const definition of definitions)filteredDashboardQuery(definition,filters)
  const head=await env.DB.prepare('SELECT max(revision) AS revision FROM bf_dashboard_bookmarks WHERE dashboard_id=? AND owner_id=? AND name=?').bind(match[1],ownerId,name).first<{revision:number|null}>()
  if(input.previousRevision!==(head?.revision??null))fail('dashboard_bookmark_revision_changed',409)
  const revision=(head?.revision??0)+1;if(revision>100)fail('dashboard_bookmark_revision_limit',409)
  const now=new Date().toISOString()
  await transact(env.DB,owner,[...guards.map(assertion),assertion(sql('(SELECT max(revision) FROM bf_dashboard_bookmarks WHERE dashboard_id=? AND owner_id=? AND name=?) IS ?',match[1],ownerId,name,head?.revision??null)),assertion(sql('(SELECT count(DISTINCT name) FROM bf_dashboard_bookmarks WHERE dashboard_id=? AND owner_id=?)<?',match[1],ownerId,head?.revision?21:20)),sql('INSERT INTO bf_dashboard_bookmarks(dashboard_id,owner_id,name,revision,filters_json,created_at) VALUES(?,?,?,?,?,?)',match[1],ownerId,name,revision,canonicalJson(filters),now)])
  return json({name,revision,filters,createdAt:now},201)
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'dashboard_bookmark_conflict'},409)}finally{await discardBody(request)}
}
