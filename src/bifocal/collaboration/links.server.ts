import {randomUUID} from 'node:crypto'
import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {subject,member,permittedMembers,subjectChanges,type Subject} from './subjects.server'
import {fail} from '../query/types'
export type Link={id:string;subject_key:string;issuer_id:string;issuer_version:number;recipient_id:string;recipient_version:number;expires_at:string;revoked:number}
export const linkGuard=(row:Link)=>sql("EXISTS(SELECT 1 FROM bf_collaboration_links WHERE id=? AND revoked=0 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND issuer_version=? AND recipient_version=?)",row.id,row.issuer_version,row.recipient_version)
export const audit=(actor:Authority,action:string,id:string)=>sql('INSERT INTO bf_collaboration_audit(id,actor_id,action,resource_id,recorded_at) VALUES(?,?,?,?,?)',randomUUID(),actor.id,action,id,new Date().toISOString())
export async function prepareLink(env:Bindings,actor:Authority,target:Subject,recipientId:unknown,expiresAt:unknown){
 if(typeof recipientId!=='string')fail('collaboration_recipient_not_permitted',403)
 const people=await permittedMembers(env,actor,target),recipient=people.find(p=>p.id===recipientId),issuer=await member(env,actor.id)
 if(!recipient)fail('collaboration_recipient_not_permitted',403)
 const expiry=typeof expiresAt==='string'?Date.parse(expiresAt):NaN
 if(!Number.isFinite(expiry)||new Date(expiry).toISOString()!==expiresAt||expiry<=Date.now()||expiry>Date.now()+7*86400000)fail('link_expiry_required',400)
 const id=randomUUID(),now=new Date().toISOString()
 const changes=[...subjectChanges(target),assertion(recipient.guard),assertion(issuer.guard),sql('INSERT INTO bf_collaboration_links(id,subject_key,issuer_id,issuer_version,recipient_id,recipient_version,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)',id,target.key,actor.id,issuer.version,recipient.id,recipient.version,expiresAt,now),audit(actor,'authenticated-link-issued',id)]
 return {id,href:'/app/shared/'+id,expiresAt,recipientId:recipient.id,changes}
}
export async function readLink(env:Bindings,actor:Authority,id:string){
 const row=await env.DB.prepare('SELECT * FROM bf_collaboration_links WHERE id=?').bind(id).first<Link>()
 if(!row||row.revoked||row.recipient_id!==actor.id||Date.parse(row.expires_at)<=Date.now())fail('link_access_unavailable',403)
 const issuer=await member(env,row.issuer_id),recipient=await member(env,row.recipient_id)
 if(issuer.version!==row.issuer_version||recipient.version!==row.recipient_version)fail('link_access_unavailable',403)
 const stored=await env.DB.prepare('SELECT kind,target_id,active FROM bf_collaboration_subjects WHERE key=?').bind(row.subject_key).first<{kind:string;target_id:string;active:number}>()
 if(!stored?.active)fail('link_access_unavailable',403)
 const target=await subject(env,actor,stored.kind,stored.target_id)
 if(target.key!==row.subject_key)fail('link_access_unavailable',403)
 // Both parties must retain their own analytical authority. A saved URL grants none.
 const sender=await subject(env,{...actor,id:issuer.id,role:issuer.role},stored.kind,stored.target_id)
 const guards=[...target.guards,...sender.guards,linkGuard(row),issuer.guard,recipient.guard]
 await transact(env.DB,actor,[...guards.map(assertion),audit(actor,'authenticated-link-read',id)])
 return {row,target,guards}
}
