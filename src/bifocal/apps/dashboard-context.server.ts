import {randomUUID} from 'node:crypto'
import type {Bindings} from '../../auth.server'
import type {D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import type {Authority} from '../catalog/authority.server'
import {sql} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson} from '../../modules/import-kit/src/provenance/identity.ts'
import {fail,type Filter} from '../query/types'
import type {ReaderSelection} from '../dashboards/interactions.protocol'
import type {AppDocument,AppPage} from './protocol'
export type Inherited={filters:Filter[];fiscal:ReaderSelection['fiscal']}
type App={id:string;version:number;document:AppDocument}
export function appActions(app:App,audience:string,page:AppPage) {
 const allowed=app.document.audiences.find(a=>a.key===audience)?.pages??[]
 return (page.frozen?.dashboard?.document.interactions?.actions??[]).filter(action=>app.document.pages.some(target=>allowed.includes(target.key)&&target.frozen?.dashboard?.id===action.target))
}
export async function appDashboardContext(env:Bindings,actor:Authority,app:App,audience:string,page:string,value:unknown):Promise<{inherited?:Inherited;guards:D1Sql[]}> {
 if(value===undefined||value===null)return {guards:[]}
 if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value))fail('app_context_unavailable',404)
 const row=await env.DB.prepare("SELECT context_json,source_page FROM bf_app_dashboard_contexts WHERE id=? AND app_id=? AND app_version=? AND operator_id=? AND audience=? AND target_page=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(value,app.id,app.version,actor.id,audience,page).first<{context_json:string;source_page:string}>()
 if(!row||!app.document.audiences.find(a=>a.key===audience)?.pages.includes(row.source_page))fail('app_context_unavailable',404)
 return {inherited:JSON.parse(row.context_json) as Inherited,guards:[sql("EXISTS(SELECT 1 FROM bf_app_dashboard_contexts WHERE id=? AND app_id=? AND app_version=? AND operator_id=? AND audience=? AND target_page=? AND context_json=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",value,app.id,app.version,actor.id,audience,page,row.context_json)]}
}
export function prepareAppContext(actor:Authority,app:App,audience:string,source:string,target:string,inherited:Inherited) {
 const id=randomUUID(),expiresAt=new Date(Date.now()+30*60*1000).toISOString()
 return {changes:[sql('DELETE FROM bf_app_dashboard_contexts WHERE expires_at<=?',new Date().toISOString()),sql('INSERT INTO bf_app_dashboard_contexts(id,app_id,app_version,operator_id,audience,source_page,target_page,context_json,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',id,app.id,app.version,actor.id,audience,source,target,canonicalJson(inherited),expiresAt)],result:{kind:'dashboard',contextId:id,location:'/app/apps/'+app.id+'/'+audience+'/'+target+'?context='+id}}
}
