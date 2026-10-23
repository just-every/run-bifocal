import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail } from '../query/types'
import { itemAccess, type Authority } from './authority.server'
import { digest } from './protocol'
export type Item={id:string;owner_id:string;collection_id:string|null;kind:string;title:string;description:string;tags_json:string;definition_json:string;source_links_json:string;verified:number;fingerprint:string;version:number;archived:number;updated_at:string}
export const itemGuard=(item:Item)=>sql('EXISTS(SELECT 1 FROM bf_catalog_items WHERE id=? AND owner_id=? AND version=? AND archived=?)',item.id,item.owner_id,item.version,item.archived)
export const accessGuard=(actor:Authority,id:string)=>{const access=itemAccess(actor);return sql(`EXISTS(SELECT 1 FROM bf_catalog_items i WHERE i.id=? AND ${access.sql})`,id,...access.params??[])}
export async function readItem(env:Bindings,actor:Authority,id:string):Promise<Item>{
 const access=itemAccess(actor)
 const item=await env.DB.prepare(`SELECT i.* FROM bf_catalog_items i WHERE i.id=? AND ${access.sql}`).bind(id,...access.params??[]).first<Item>()
 if(!item)fail('content_not_found',404);return item
}
export const itemDocument=(item:Item)=>({id:item.id,ownerId:item.owner_id,collectionId:item.collection_id,kind:item.kind,title:item.title,description:item.description,tags:JSON.parse(item.tags_json),definition:JSON.parse(item.definition_json),sourceLinks:JSON.parse(item.source_links_json),verified:!!item.verified,version:item.version,archived:!!item.archived,updatedAt:item.updated_at,...item.archived?{explanation:'Archived content is absent from ordinary discovery. Its retained versions, favourites, links and usage are unchanged; the owner can restore it.'}:{}})
export const audit=(actor:Authority,ownerId:string,action:string,itemId:string|null,version:number|null,hash:string|null)=>sql('INSERT INTO bf_catalog_audit(id,owner_id,actor_id,action,item_id,version,digest,recorded_at) VALUES(?,?,?,?,?,?,?,?)',randomUUID(),ownerId,actor.id,action,itemId,version,hash,new Date().toISOString())
export async function archiveReview(env:Bindings,actor:Authority,item:Item){
 const dependents=(await env.DB.prepare('SELECT i.id,i.title,i.owner_id,i.version,i.archived FROM bf_catalog_dependencies d JOIN bf_catalog_items i ON i.id=d.item_id WHERE d.depends_on=? ORDER BY i.id').bind(item.id).all()).results
 const uses=(await env.DB.prepare('SELECT count(*) AS count,max(opened_at) AS lastOpen FROM bf_catalog_usage WHERE item_id=?').bind(item.id).first())
 const review={itemId:item.id,version:item.version,archived:!!item.archived,ownerId:item.owner_id,dependents,historicalUsage:uses,operation:item.archived?'restore':'archive',reversible:true}
 const hash=digest(review),guards=[itemGuard(item),sql('(SELECT count(*) FROM bf_catalog_dependencies WHERE depends_on=?)=?',item.id,dependents.length),sql('(SELECT count(*) FROM bf_catalog_usage WHERE item_id=?)=?',item.id,uses?.count??0)]
 await transact(env.DB,actor,guards.map(assertion))
 return {review:{...review,digest:hash},guards}
}
export const versionStatement=(itemId:string,version:number,metadata:unknown)=>sql('INSERT INTO bf_catalog_versions(item_id,version,metadata_json) VALUES(?,?,?)',itemId,version,canonicalJson(metadata))
