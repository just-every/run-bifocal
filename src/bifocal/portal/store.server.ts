import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Authority } from '../catalog/authority.server'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { readDefinition, readModel, modelGuard } from '../models/validation/store.server'
import { scopedQuery } from '../models/validation/protocol'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail } from '../query/types'
import { documentInput, parameters, type TenantDocument } from './protocol'
export type Tenant={id:string;owner_id:string;status:string;generation:number;head:number;published:number|null}
export type Release={document:TenantDocument;sources:{id:string;revision:string;digest:string}[]}
export const guard=(t:Tenant)=>sql('EXISTS(SELECT 1 FROM bf_portal_tenants WHERE id=? AND owner_id=? AND generation=? AND head=? AND published IS ? AND status=?)',t.id,t.owner_id,t.generation,t.head,t.published,t.status)
export const liveGuard=(t:Tenant)=>sql("EXISTS(SELECT 1 FROM bf_portal_tenants t JOIN bf_portal_activation a ON a.tenant_id=t.id AND a.generation=t.generation WHERE t.id=? AND t.generation=? AND t.status='active')",t.id,t.generation)
export const audit=(t:Tenant,a:Authority,action:string)=>sql('INSERT INTO bf_portal_audit VALUES(?,?,?,?,?,?)',randomUUID(),t.id,a.id,action,t.generation,new Date().toISOString())
export async function tenant(env:Bindings,actor:Authority,id:string){
 const t=await env.DB.prepare("SELECT * FROM bf_portal_tenants WHERE id=? AND owner_id=? AND status<>'erased'").bind(id,actor.id).first<Tenant>()
 if(!t)fail('tenant_not_found',404);return t
}
export async function release(env:Bindings,t:Tenant,version=t.published) {
 const row=await env.DB.prepare('SELECT document_json,digest FROM bf_portal_releases WHERE tenant_id=? AND version=?').bind(t.id,version).first<{document_json:string;digest:string}>()
 if(!row||sha256(row.document_json)!==row.digest)fail('tenant_release_unavailable',409)
 return {...row,content:JSON.parse(row.document_json) as Release}
}
export async function compute(env:Bindings,owner:string,doc:TenantDocument,input:Record<string,unknown>,expected?:Release['sources']) {
 const model=await readModel(env,owner,doc.modelId)
 if(model.production!==doc.revision)fail('tenant_model_changed',409)
 const view=(await readDefinition(env,doc.revision)).views.find(v=>v.id===doc.viewId)
 if(!view||view.query.joins.length)fail('tenant_view_unavailable',409)
 const allowed=view.query.semantic?.dimensions.map(d=>d.column)??view.query.groupBy
 if(doc.dimensions.some(d=>!allowed.includes(d))||doc.rows.some(r=>!allowed.includes(r.column)))fail('tenant_scope_not_in_model',403)
 const p=parameters(input,doc),query=scopedQuery(view,doc.revision)
 query.groupBy=p.groupBy;query.filters=[...query.filters,...doc.rows,...p.filters]
 const context=await queryContext(env,query,owner),sources=await readSources(env,query)
 const refs=sources.map(s=>({id:s.id,revision:s.revision,digest:sha256(s.value_json)}))
 if(expected&&canonicalJson(refs)!==canonicalJson(expected))fail('tenant_source_changed',409)
 const answer=execute(query,sources,context)
 const result={schema:1,sdk:1,name:doc.name,color:doc.color,groupBy:p.groupBy,rows:answer.rows.map(r=>({dimensions:r.dimensions,values:Object.fromEntries(Object.entries(r.values).map(([k,v])=>[k,{state:v.state,value:v.value}]))})),totals:Object.fromEntries(Object.entries(answer.totals).map(([k,v])=>[k,{state:v.state,value:v.value}])),matchingRows:answer.filteredRows}
 return {result,refs,guards:[modelGuard(model),...context.guards??[],...sources.map(sourceMatch)]}
}
export async function review(env:Bindings,t:Tenant,value:unknown) {
 const document=documentInput(value),run=await compute(env,t.owner_id,document,{})
 const content:Release={document,sources:run.refs},text=canonicalJson(content)
 return {content,text,digest:sha256(text),reviewedDigest:sha256(canonicalJson({generation:t.generation,head:t.head,content})),run}
}
/** Invalidation and the tenant generation change commit in the same D1 batch. */
export const withdraw=(t:Tenant)=>[
 sql('DELETE FROM bf_portal_tokens WHERE tenant_id=?',t.id),sql('DELETE FROM bf_portal_cache WHERE tenant_id=?',t.id),
 sql("UPDATE bf_portal_jobs SET state='cancelled' WHERE tenant_id=? AND state IN ('queued','processing')",t.id)
]
export async function transition(env:Bindings,actor:Authority,t:Tenant,action:'suspend'|'rotate'|'erase',previous:unknown) {
 if(previous!==t.generation)fail('tenant_generation_changed',409)
 const status=action==='erase'?'erased':action==='suspend'?'suspended':t.status
 await transact(env.DB,actor,[assertion(guard(t)),...withdraw(t),
  ...(action==='rotate'?[sql('UPDATE bf_portal_activation SET generation=? WHERE tenant_id=? AND generation=?',t.generation+1,t.id,t.generation)]:[sql('DELETE FROM bf_portal_activation WHERE tenant_id=?',t.id)]),
  ...action==='erase'?['bf_portal_releases','bf_portal_jobs','bf_portal_usage'].map(table=>sql('DELETE FROM '+table+' WHERE tenant_id=?',t.id)):[],
  sql('UPDATE bf_portal_tenants SET generation=generation+1,status=?,published=CASE WHEN ? THEN NULL ELSE published END WHERE id=?',status,action==='erase'?1:0,t.id),audit(t,actor,action)])
 return {id:t.id,status,generation:t.generation+1}
}
