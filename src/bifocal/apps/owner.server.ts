import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'
import { fail } from '../query/types'
import { appDocument, documentDigest, key as keyOf, type AppDocument } from './protocol'
import { appGuard, audit, readApp, readVersions } from './store.server'

export async function createApp(env:Bindings,actor:Authority,value:unknown) {
 const document=appDocument(value),id=randomUUID(),draft=JSON.stringify(document)
 await transact(env.DB,actor,[sql('INSERT INTO bf_apps(id,owner_id,draft_json,draft_revision,created_at) VALUES(?,?,?,1,?)',id,actor.id,draft,new Date().toISOString()),audit(actor,{id,owner_id:actor.id},'draft-created',null,null,documentDigest(document))])
 return {id,draftRevision:1}
}
export async function saveDraft(env:Bindings,actor:Authority,id:string,previousRevision:unknown,value:unknown) {
 const app=await readApp(env,actor.id,id),document=appDocument(value)
 if(previousRevision!==app.draft_revision)fail('app_draft_revision_changed',409)
 await transact(env.DB,actor,[assertion(appGuard(app)),sql('UPDATE bf_apps SET draft_json=?,draft_revision=draft_revision+1 WHERE id=?',JSON.stringify(document),id),audit(actor,app,'draft-saved',null,null,documentDigest(document))])
 return {id,draftRevision:app.draft_revision+1}
}
/** Membership is live and immediate; a published version never carries or restores it. */
export async function setMember(env:Bindings,actor:Authority,id:string,input:Record<string,unknown>) {
 const app=await readApp(env,actor.id,id),audience=keyOf(input.audience,'app_audience_required'),draft=appDocument(JSON.parse(app.draft_json)) as AppDocument
 const published=app.published_version?(await env.DB.prepare('SELECT document_json FROM bf_app_versions WHERE app_id=? AND version=?').bind(id,app.published_version).first<{document_json:string}>()):null
 if(!draft.audiences.some(a=>a.key===audience)&&!(published&&(JSON.parse(published.document_json) as AppDocument).audiences.some(a=>a.key===audience)))fail('app_audience_not_found',404)
 if(typeof input.operatorId!=='string'||typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.operatorVersion)||input.operatorId===actor.id)fail('app_member_required',400)
 const person=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active' AND role<>'owner'").bind(input.operatorId).first<{version:number}>()
 const now=new Date().toISOString()
 if(!input.enabled) {
  await transact(env.DB,actor,[sql('DELETE FROM bf_app_members WHERE app_id=? AND audience=? AND operator_id=?',id,audience,input.operatorId),
   sql("UPDATE bf_app_subscriptions SET ended_at=?,ended_reason='audience-removed' WHERE app_id=? AND audience=? AND operator_id=? AND ended_at IS NULL",now,id,audience,input.operatorId),audit(actor,app,'member-removed',input.operatorId+':'+audience,app.published_version,null)])
  return {audience,operatorId:input.operatorId,enabled:false}
 }
 if(!person||person.version!==input.operatorVersion)fail('membership_changed',409)
 await transact(env.DB,actor,[assertion(sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?)",input.operatorId,person.version)),
  sql('INSERT INTO bf_app_members(app_id,audience,operator_id,operator_version,added_at) VALUES(?,?,?,?,?) ON CONFLICT(app_id,audience,operator_id) DO UPDATE SET operator_version=excluded.operator_version',id,audience,input.operatorId,person.version,now),audit(actor,app,'member-added',input.operatorId+':'+audience,app.published_version,null)])
 return {audience,operatorId:input.operatorId,enabled:true}
}
export async function appList(env:Bindings,actor:Authority) {
 const rows=(await env.DB.prepare('SELECT id,draft_json,draft_revision,head_version,published_version FROM bf_apps WHERE owner_id=? ORDER BY created_at,id LIMIT 101').bind(actor.id).all<{id:string;draft_json:string;draft_revision:number;head_version:number;published_version:number|null}>()).results
 if(rows.length>100)fail('app_list_limit',413)
 await transact(env.DB,actor,[])
 return rows.map(row=>({id:row.id,title:(JSON.parse(row.draft_json) as AppDocument).title,draftRevision:row.draft_revision,publishedVersion:row.published_version}))
}
export async function appDetail(env:Bindings,actor:Authority,id:string) {
 const app=await readApp(env,actor.id,id),versions=await readVersions(env,id)
 if(versions.length>100)fail('app_history_limit',413)
 const members=(await env.DB.prepare(`SELECT m.audience,m.operator_id AS operatorId,m.operator_version AS operatorVersion,p.email,p.display_name AS displayName,
  CASE WHEN p.status='active' AND p.version=m.operator_version THEN 1 ELSE 0 END AS active FROM bf_app_members m JOIN oa_operators p ON p.id=m.operator_id WHERE m.app_id=? ORDER BY m.audience,p.email LIMIT 500`).bind(id).all<{audience:string;operatorId:string;operatorVersion:number;email:string;displayName:string;active:number}>()).results
 const subscriptions=(await env.DB.prepare('SELECT s.id,s.audience,s.page_key AS pageKey,p.email,s.created_at AS createdAt,s.ended_at AS endedAt,s.ended_reason AS endedReason FROM bf_app_subscriptions s JOIN oa_operators p ON p.id=s.operator_id WHERE s.app_id=? ORDER BY s.created_at,s.id LIMIT 500').bind(id).all()).results
 const history=(await env.DB.prepare('SELECT action,subject,version,digest,recorded_at AS recordedAt FROM bf_app_audit WHERE app_id=? ORDER BY recorded_at DESC,id LIMIT 200').bind(id).all()).results
 await transact(env.DB,actor,[assertion(appGuard(app))])
 return {id,draft:{revision:app.draft_revision,document:JSON.parse(app.draft_json) as AppDocument},publishedVersion:app.published_version,
  versions:versions.map(v=>({version:v.version,action:v.action,restores:v.restores,digest:v.digest,createdAt:v.created_at,audiences:(JSON.parse(v.document_json) as AppDocument).audiences.map(a=>a.name),pages:(JSON.parse(v.document_json) as AppDocument).pages.length})),
  members:members.map(m=>({...m,active:!!m.active})),subscriptions,history}
}
