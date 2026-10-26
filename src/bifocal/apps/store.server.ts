import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'
import { fail } from '../query/types'
import type { AppDocument } from './protocol'

export type AppRow={id:string;owner_id:string;draft_json:string;draft_revision:number;head_version:number;published_version:number|null;created_at:string}
export type VersionRow={app_id:string;version:number;document_json:string;digest:string;action:'publish'|'rollback';restores:number|null;actor_id:string;created_at:string}
export const readApp=async(env:Bindings,ownerId:string,id:string)=>{
 const row=await env.DB.prepare('SELECT * FROM bf_apps WHERE id=? AND owner_id=?').bind(id,ownerId).first<AppRow>()
 if(!row)fail('app_not_found',404)
 return row
}
export const appGuard=(row:AppRow)=>sql('EXISTS(SELECT 1 FROM bf_apps WHERE id=? AND owner_id=? AND draft_revision=? AND head_version=? AND published_version IS ? AND draft_json=?)',row.id,row.owner_id,row.draft_revision,row.head_version,row.published_version,row.draft_json)
export const readVersions=async(env:Bindings,id:string)=>(await env.DB.prepare('SELECT * FROM bf_app_versions WHERE app_id=? ORDER BY version DESC LIMIT 101').bind(id).all<VersionRow>()).results
export const readVersion=async(env:Bindings,id:string,version:number)=>{
 const row=await env.DB.prepare('SELECT * FROM bf_app_versions WHERE app_id=? AND version=?').bind(id,version).first<VersionRow>()
 if(!row)fail('app_version_not_found',404)
 return {...row,document:JSON.parse(row.document_json) as AppDocument}
}
export const versionGuard=(version:Pick<VersionRow,'app_id'|'version'|'digest'>)=>sql('EXISTS(SELECT 1 FROM bf_app_versions WHERE app_id=? AND version=? AND digest=?)',version.app_id,version.version,version.digest)
export const audit=(actor:Authority,app:Pick<AppRow,'id'|'owner_id'>,action:string,subject:string|null,version:number|null,digest:string|null)=>sql('INSERT INTO bf_app_audit(id,app_id,owner_id,actor_id,action,subject,version,digest,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),app.id,app.owner_id,actor.id,action,subject,version,digest,new Date().toISOString())
/** The live published version, the member's audience and the account version, asserted together. */
export const entitlementGuard=(actor:Authority,appId:string,audience:string,version:number,digest:string)=>sql(`EXISTS(SELECT 1 FROM bf_apps a JOIN bf_app_versions v ON v.app_id=a.id AND v.version=a.published_version
 JOIN bf_app_members m ON m.app_id=a.id JOIN oa_operators o ON o.id=m.operator_id AND o.status='active' AND o.version=m.operator_version
 WHERE a.id=? AND a.published_version=? AND v.digest=? AND m.audience=? AND m.operator_id=?)`,appId,version,digest,audience,actor.id)
/** Apps a member can currently open, with only the audiences that member belongs to. */
export async function entitledApps(env:Bindings,actor:Authority){
 const rows=(await env.DB.prepare(`SELECT a.id,a.owner_id,v.version,v.digest,v.document_json,m.audience FROM bf_app_members m JOIN bf_apps a ON a.id=m.app_id
  JOIN bf_app_versions v ON v.app_id=a.id AND v.version=a.published_version JOIN oa_operators o ON o.id=m.operator_id AND o.status='active' AND o.version=m.operator_version
  WHERE m.operator_id=? ORDER BY a.id,m.audience LIMIT 201`).bind(actor.id).all<{id:string;owner_id:string;version:number;digest:string;document_json:string;audience:string}>()).results
 if(rows.length>200)fail('app_home_limit',413)
 const apps=new Map<string,{id:string;ownerId:string;version:number;digest:string;document:AppDocument;audiences:string[]}>()
 for(const row of rows){
  const document=JSON.parse(row.document_json) as AppDocument
  if(!document.audiences.some(a=>a.key===row.audience))continue
  const app=apps.get(row.id)??{id:row.id,ownerId:row.owner_id,version:row.version,digest:row.digest,document,audiences:[]}
  app.audiences.push(row.audience);apps.set(row.id,app)
 }
 return [...apps.values()]
}
