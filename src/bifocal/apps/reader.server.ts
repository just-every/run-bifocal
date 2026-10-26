import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'
import { fail } from '../query/types'
import { runPage } from './content.server'
import { audit, entitledApps, entitlementGuard } from './store.server'

function absent():never{return fail('app_not_found',404)}
export async function homeEntries(env:Bindings,actor:Authority) {
 const apps=await entitledApps(env,actor)
 await transact(env.DB,actor,[])
 return apps.map(app=>({id:app.id,title:app.document.title,version:app.version,href:'/app/apps/'+app.id,audiences:app.document.audiences.filter(a=>app.audiences.includes(a.key)).map(a=>({key:a.key,name:a.name}))}))
}
async function member(env:Bindings,actor:Authority,id:string) {
 const app=(await entitledApps(env,actor)).find(candidate=>candidate.id===id)
 if(!app)absent()
 return app
}
/** Navigation lists only the audiences this member belongs to; nothing else is named. */
export async function appView(env:Bindings,actor:Authority,id:string) {
 const app=await member(env,actor,id),audiences=app.document.audiences.filter(a=>app.audiences.includes(a.key))
 await transact(env.DB,actor,audiences.map(a=>assertion(entitlementGuard(actor,id,a.key,app.version,app.digest))))
 return {id,title:app.document.title,version:app.version,audiences:audiences.map(a=>({key:a.key,name:a.name,landing:'/app/apps/'+id+'/'+a.key+'/'+a.landing,pages:a.pages.map(key=>{const page=app.document.pages.find(p=>p.key===key)!;return {key,title:page.title,kind:page.kind,href:'/app/apps/'+id+'/'+a.key+'/'+key}})}))}
}
export async function pageView(env:Bindings,actor:Authority,id:string,audienceKey:string,pageKey:string) {
 const app=await member(env,actor,id),audience=app.document.audiences.find(a=>a.key===audienceKey&&app.audiences.includes(a.key)),page=app.document.pages.find(p=>p.key===pageKey)
 if(!audience||!page||!audience.pages.includes(pageKey))fail('app_page_not_found',404)
 const run=await runPage(env,app.ownerId,page,audience)
 await transact(env.DB,actor,[assertion(entitlementGuard(actor,id,audienceKey,app.version,app.digest)),...run.guards.map(assertion)])
 return {app:{id,title:app.document.title,version:app.version},audience:{key:audience.key,name:audience.name},page:{key:page.key,title:page.title,kind:page.kind},cards:run.cards,target:run.target??null}
}
export async function subscribe(env:Bindings,actor:Authority,id:string,input:Record<string,unknown>) {
 if(typeof input.audience!=='string'||typeof input.pageKey!=='string')fail('app_subscription_required',400)
 const app=await member(env,actor,id),audience=app.document.audiences.find(a=>a.key===input.audience&&app.audiences.includes(a.key))
 if(!audience||!audience.pages.includes(input.pageKey))fail('app_page_not_found',404)
 const subscription=randomUUID()
 await transact(env.DB,actor,[assertion(entitlementGuard(actor,id,audience.key,app.version,app.digest)),sql('INSERT INTO bf_app_subscriptions(id,app_id,operator_id,audience,page_key,created_at) VALUES(?,?,?,?,?,?)',subscription,id,actor.id,audience.key,input.pageKey,new Date().toISOString()),audit(actor,{id,owner_id:app.ownerId},'subscription-created',input.pageKey,app.version,null)])
 return {id:subscription,audience:audience.key,pageKey:input.pageKey,delivery:'inactive',dispatcher:'unavailable'}
}
type Subscription={id:string;audience:string;page_key:string;created_at:string}
async function current(env:Bindings,actor:Authority,id:string) {
 const app=await member(env,actor,id),rows=(await env.DB.prepare('SELECT id,audience,page_key,created_at FROM bf_app_subscriptions WHERE app_id=? AND operator_id=? AND ended_at IS NULL ORDER BY created_at,id LIMIT 101').bind(id,actor.id).all<Subscription>()).results
 return {app,rows:rows.filter(row=>app.audiences.includes(row.audience)&&app.document.audiences.find(a=>a.key===row.audience)?.pages.includes(row.page_key))}
}
export async function subscriptions(env:Bindings,actor:Authority,id:string) {
 const {app,rows}=await current(env,actor,id)
 await transact(env.DB,actor,rows.map(row=>assertion(entitlementGuard(actor,id,row.audience,app.version,app.digest))))
 return {subscriptions:rows.map(row=>({id:row.id,audience:row.audience,pageKey:row.page_key,title:app.document.pages.find(p=>p.key===row.page_key)!.title,createdAt:row.created_at,delivery:'inactive'}))}
}
/** What the next delivery would contain right now, computed under current entitlement and never sent. */
export async function subscriptionPreview(env:Bindings,actor:Authority,id:string,subscription:string) {
 const {rows}=await current(env,actor,id),row=rows.find(r=>r.id===subscription)
 if(!row)fail('app_subscription_not_found',404)
 return {delivered:false,dispatcher:'unavailable',content:await pageView(env,actor,id,row.audience,row.page_key)}
}
export async function endSubscription(env:Bindings,actor:Authority,id:string,subscription:string) {
 const {rows}=await current(env,actor,id),row=rows.find(r=>r.id===subscription)
 if(!row)fail('app_subscription_not_found',404)
 await transact(env.DB,actor,[sql("UPDATE bf_app_subscriptions SET ended_at=?,ended_reason='member-ended' WHERE id=? AND operator_id=?",new Date().toISOString(),subscription,actor.id)])
 return {id:subscription,ended:true}
}
