import { runtimeBindings, type Bindings } from '../../../auth.server'
import { fileOwner } from '../../imports/files/owner.server'
import { ownerIdentity } from '../../data/snapshots/store'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { fail, QueryError } from '../../query/types'
import { appGuard, appList, appRow, contentDigest, publish, publishedContent, resolveContent, saveDraft } from './store.server'
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
async function input(request:Request):Promise<Record<string,unknown>>{
 if(!request.headers.get('content-type')?.startsWith('application/json')||!request.body)fail('json_body_required',400)
 const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[]
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32768)fail('app_request_too_large',413);chunks.push(part.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail('json_object_required',400);return value
 }catch(error){if(error instanceof QueryError)throw error;fail('invalid_json',400)}finally{await reader.cancel();reader.releaseLock()}
}
export async function reportingAppsResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url);if(!/^\/api\/operator\/apps(?:\/|$)/.test(url.pathname))return null
 const env=runtimeBindings(original)
 try{
  const owner=await fileOwner(request,env)
  if(!owner){await request.body?.cancel();return json({error:'owner_required'},401)}
  const ownerId=await ownerIdentity(env,owner)
  if(url.search)fail('query_parameters_not_supported',400)
  const path=url.pathname
  if(path==='/api/operator/apps'){
   if(request.method==='GET')return json({apps:await appList(env,owner,ownerId),access:'owner-only'})
   if(request.method==='POST')return json({id:await saveDraft(env,owner,ownerId,await input(request))},201)
   return json({error:'method_not_allowed'},405)
  }
  if(path==='/api/operator/apps/content'){
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   const questions=(await env.DB.prepare('SELECT id,created_at FROM bf_query_snapshots WHERE owner_id=? ORDER BY created_at DESC LIMIT 100').bind(ownerId).all<{id:string;created_at:string}>()).results
   const artifacts=(await env.DB.prepare('SELECT id,kind,title FROM bf_query_artifacts WHERE owner_id=? UNION ALL SELECT id,kind,title FROM bf_analytics_boards WHERE owner_id=? LIMIT 100').bind(ownerId,ownerId).all<{id:string;kind:string;title:string}>()).results
   await transact(env.DB,owner,[])
   return json({items:[...questions.map(q=>({kind:'queries',id:q.id,label:'Answer from '+q.created_at})),...artifacts.map(a=>({kind:a.kind==='dashboard'?'dashboards':'reports',id:a.id,label:a.title}))]})
  }
  const match=/^\/api\/operator\/apps\/([a-f0-9-]{36})(?:\/(review|publish|rollback|published))?$/.exec(path)
  if(!match)fail('app_not_found',404)
  const row=await appRow(env,ownerId,match[1]),action=match[2]
  if(!action&&request.method==='PUT')return json({id:await saveDraft(env,owner,ownerId,await input(request),row.id)})
  if((action==='publish'||action==='rollback')&&request.method==='POST'){await publish(env,owner,ownerId,row,await input(request),action==='rollback');return json({id:row.id})}
  if(request.method!=='GET'||action==='publish'||action==='rollback')return json({error:'method_not_allowed'},405)
  if(action==='published')return json(await publishedContent(env,owner,ownerId,row))
  const draft=row.draft_json?JSON.parse(row.draft_json):null
  if(action==='review'){
   if(!draft)fail('app_draft_withdrawn',409)
   const resolved=await resolveContent(env,owner,ownerId,draft);await transact(env.DB,owner,[assertion(appGuard(row)),...resolved.guards.map(assertion)])
   return json({generation:row.generation,content:draft,digest:contentDigest(draft),access:'owner-only',schedules:'unavailable'})
  }
  const versions=(await env.DB.prepare('SELECT id,ordinal,content_json,digest,created_at FROM bf_reporting_versions WHERE app_id=? ORDER BY ordinal DESC').bind(row.id).all<{id:string;ordinal:number;content_json:string;digest:string;created_at:string}>()).results
  const history=(await env.DB.prepare('SELECT generation,action,version_id,created_at FROM bf_reporting_events WHERE app_id=? ORDER BY generation').bind(row.id).all()).results
  await transact(env.DB,owner,[assertion(appGuard(row))])
  return json({id:row.id,generation:row.generation,draft,digest:draft?contentDigest(draft):null,publishedVersion:row.published_version,versions:versions.map(v=>({id:v.id,ordinal:v.ordinal,content:JSON.parse(v.content_json),digest:v.digest,createdAt:v.created_at})),history})
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'app_conflict',reason:'The session, content or reviewed app changed. Reload and review again.'},409)}
}
