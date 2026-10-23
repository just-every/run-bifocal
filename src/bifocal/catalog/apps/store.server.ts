import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { readQuery } from '../../data/snapshots/store'
import { readBoard } from '../../dashboards/store.server'
import { fail } from '../../query/types'
export type Authority=D1Sql & {email:string}
export type Content={title:string;items:{kind:'queries'|'dashboards'|'reports';id:string;label:string}[]}
export type AppRow={id:string;owner_id:string;generation:number;version_counter:number;draft_json:string|null;published_version:string|null;created_at:string}
export type Version={id:string;app_id:string;ordinal:number;content_json:string;digest:string;created_at:string}
const uuid=/^[a-f0-9-]{36}$/
export const contentDigest=(content:Content)=>sha256(canonicalJson(content))
export function contentInput(input:Record<string,unknown>):Content {
 if(typeof input.title!=='string'||!input.title.trim()||input.title.length>160||!Array.isArray(input.items)||input.items.length<1||input.items.length>20)fail('app_title_and_one_to_twenty_items_required',400)
 const items:Content['items']=[]
 for(const value of input.items){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_app_item',400)
  const item=value as Record<string,unknown>
  if(Object.keys(item).some(k=>!['kind','id','label'].includes(k))||!['queries','dashboards','reports'].includes(String(item.kind))||typeof item.id!=='string'||!uuid.test(item.id)||typeof item.label!=='string'||!item.label.trim()||item.label.length>160)fail('invalid_app_item',400)
  items.push({kind:item.kind as Content['items'][number]['kind'],id:item.id,label:item.label.trim()})
 }
 if(new Set(items.map(i=>i.kind+':'+i.id)).size!==items.length)fail('duplicate_app_item',400)
 return {title:input.title.trim(),items}
}
export async function appRow(env:Bindings,ownerId:string,id:string):Promise<AppRow> {
 const row=await env.DB.prepare('SELECT * FROM bf_reporting_apps WHERE id=? AND owner_id=?').bind(id,ownerId).first<AppRow>()
 if(!row)fail('app_not_found',404)
 return row
}
export const appGuard=(row:AppRow)=>sql('EXISTS(SELECT 1 FROM bf_reporting_apps WHERE id=? AND owner_id=? AND generation=? AND draft_json IS ? AND published_version IS ?)',row.id,row.owner_id,row.generation,row.draft_json,row.published_version)
/** Resolve only existing native resources. This grants no new access to them. */
export async function resolveContent(env:Bindings,owner:Authority,ownerId:string,content:Content){
 const guards:D1Sql[]=[],snapshots=new Set<string>()
 for(const item of content.items){
  if(item.kind==='queries'){
   const q=await readQuery(env,owner,ownerId,item.id);guards.push(q.guard);snapshots.add(item.id)
  }else{
   const kind=item.kind==='dashboards'?'dashboard':'report',board=await readBoard(env,owner,ownerId,item.id,kind)
   if(board){guards.push(...board.guards);for(const card of board.cards)snapshots.add(card.snapshotId)}
   else{
    const artifact=await env.DB.prepare('SELECT snapshot_id FROM bf_query_artifacts WHERE id=? AND kind=? AND owner_id=?').bind(item.id,kind,ownerId).first<{snapshot_id:string}>()
    if(!artifact)fail('app_content_unavailable',409)
    const q=await readQuery(env,owner,ownerId,artifact.snapshot_id);guards.push(q.guard,sql('EXISTS(SELECT 1 FROM bf_query_artifacts WHERE id=? AND owner_id=? AND kind=? AND snapshot_id=?)',item.id,ownerId,kind,artifact.snapshot_id));snapshots.add(artifact.snapshot_id)
   }
  }
 }
 return {guards,snapshots:[...snapshots]}
}
export async function saveDraft(env:Bindings,owner:Authority,ownerId:string,input:Record<string,unknown>,id?:string){
 const allowed=id?['generation','title','items']:['title','items']
 if(Object.keys(input).some(k=>!allowed.includes(k)))fail('unsupported_app_fields',400)
 const content=contentInput(input),resolved=await resolveContent(env,owner,ownerId,content),now=new Date().toISOString()
 const row=id?await appRow(env,ownerId,id):null,appId=id??randomUUID()
 if(row&&input.generation!==row.generation)fail('app_changed_review_again',409)
 const generation=row?row.generation+1:1
 await transact(env.DB,owner,[...resolved.guards.map(assertion),...(row?[assertion(appGuard(row)),sql('UPDATE bf_reporting_apps SET draft_json=?,generation=? WHERE id=?',canonicalJson(content),generation,appId),sql('DELETE FROM bf_reporting_draft_dependencies WHERE app_id=?',appId)]:[sql('INSERT INTO bf_reporting_apps(id,owner_id,draft_json,created_at) VALUES(?,?,?,?)',appId,ownerId,canonicalJson(content),now)]),...resolved.snapshots.map(snapshot=>sql('INSERT INTO bf_reporting_draft_dependencies(app_id,snapshot_id) VALUES(?,?)',appId,snapshot)),sql('INSERT INTO bf_reporting_events(id,app_id,generation,action,actor_id,created_at) VALUES(?,?,?,?,?,?)',randomUUID(),appId,generation,'draft',ownerId,now)])
 return appId
}
export async function publishedContent(env:Bindings,owner:Authority,ownerId:string,row:AppRow){
 if(!row.published_version)fail('app_not_published',404)
 const version=await env.DB.prepare('SELECT * FROM bf_reporting_versions WHERE id=? AND app_id=?').bind(row.published_version,row.id).first<Version>()
 if(!version)fail('app_not_published',404)
 const content=JSON.parse(version.content_json) as Content
 if(contentDigest(content)!==version.digest)fail('app_integrity_conflict',409)
 const resolved=await resolveContent(env,owner,ownerId,content)
 await transact(env.DB,owner,[assertion(appGuard(row)),assertion(sql('EXISTS(SELECT 1 FROM bf_reporting_versions WHERE id=? AND app_id=? AND digest=? AND content_json=?)',version.id,row.id,version.digest,version.content_json)),...resolved.guards.map(assertion)])
 return {versionId:version.id,ordinal:version.ordinal,content,digest:version.digest,createdAt:version.created_at}
}
export async function publish(env:Bindings,owner:Authority,ownerId:string,row:AppRow,input:Record<string,unknown>,rollback:boolean){
 if(Object.keys(input).some(k=>!(rollback?['generation','versionId','reviewedDigest']:['generation','reviewedDigest']).includes(k))||input.generation!==row.generation)fail('app_changed_review_again',409)
 const prior=rollback&&typeof input.versionId==='string'?await env.DB.prepare('SELECT * FROM bf_reporting_versions WHERE id=? AND app_id=?').bind(input.versionId,row.id).first<Version>():null
 if(rollback&&!prior)fail('app_version_unavailable',404)
 if(!rollback&&!row.draft_json)fail('app_draft_withdrawn',409)
 const encoded=prior?.content_json??row.draft_json!,content=JSON.parse(encoded) as Content,digest=contentDigest(content)
 if(input.reviewedDigest!==digest||prior&&prior.digest!==digest)fail('exact_app_review_required',409)
 const resolved=await resolveContent(env,owner,ownerId,content),id=prior?.id??randomUUID(),now=new Date().toISOString(),generation=row.generation+1
 await transact(env.DB,owner,[assertion(appGuard(row)),...resolved.guards.map(assertion),...(prior?[assertion(sql('EXISTS(SELECT 1 FROM bf_reporting_versions WHERE id=? AND app_id=? AND digest=? AND content_json=?)',id,row.id,digest,encoded))]:[sql('INSERT INTO bf_reporting_versions(id,app_id,ordinal,content_json,digest,created_at) VALUES(?,?,?,?,?,?)',id,row.id,row.version_counter+1,encoded,digest,now),...resolved.snapshots.map(snapshot=>sql('INSERT INTO bf_reporting_dependencies(version_id,snapshot_id) VALUES(?,?)',id,snapshot))]),sql('UPDATE bf_reporting_apps SET published_version=?,generation=?,version_counter=? WHERE id=?',id,generation,row.version_counter+(rollback?0:1),row.id),sql('INSERT INTO bf_reporting_events(id,app_id,generation,action,version_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),row.id,generation,rollback?'rollback':'publish',id,ownerId,now)])
}
export async function appList(env:Bindings,owner:Authority,ownerId:string){
 const rows=(await env.DB.prepare('SELECT a.id,a.generation,a.published_version,a.draft_json,v.content_json,v.ordinal FROM bf_reporting_apps a LEFT JOIN bf_reporting_versions v ON v.id=a.published_version WHERE a.owner_id=? ORDER BY a.created_at,a.id LIMIT 100').bind(ownerId).all<{id:string;generation:number;published_version:string|null;draft_json:string|null;content_json:string|null;ordinal:number|null}>()).results
 await transact(env.DB,owner,rows.map(row=>assertion(sql('EXISTS(SELECT 1 FROM bf_reporting_apps WHERE id=? AND owner_id=? AND generation=? AND draft_json IS ? AND published_version IS ?)',row.id,ownerId,row.generation,row.draft_json,row.published_version))))
 return rows.map(row=>({id:row.id,generation:row.generation,publishedVersion:row.published_version,ordinal:row.ordinal,title:row.content_json?JSON.parse(row.content_json).title:row.draft_json?JSON.parse(row.draft_json).title:'Withdrawn app'}))
}
