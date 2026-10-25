import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { type Authority } from '../catalog/authority.server'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { modelGuard, readModel, readDefinition } from '../models/validation/store.server'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { queryInput } from '../query/validate'
import { fail, type Filter } from '../query/types'
type Definition={operatorId:string;operatorVersion:number;ownerVersion:number;modelId:string;revision:string;viewId:string;filters:Filter[];dimensions:string[];underlying:boolean;summaryExport:boolean;underlyingExport:boolean;expiresAt:string;sources:{id:string;revision:string;digest:string}[]}
export type Grant={id:string;owner_id:string;operator_id:string;definition_json:string;digest:string;definition:Definition}
export const audit=(actor:Authority,grant:Grant,action:string)=>sql('INSERT INTO bf_explore_audit(id,owner_id,actor_id,grant_id,digest,action,recorded_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),grant.owner_id,actor.id,grant.id,grant.digest,action,new Date().toISOString())
export const grantGuard=(actor:Authority,id:string)=>sql(`EXISTS(SELECT 1 FROM bf_explore_grants g JOIN bf_explore_activation a ON a.grant_id=g.id
 JOIN oa_operators o ON o.id=g.owner_id AND o.status='active' AND o.role='owner' AND o.version=a.owner_version
 JOIN oa_operators p ON p.id=g.operator_id AND p.status='active' AND p.version=a.operator_version
 JOIN bf_semantic_models m ON m.id=g.model_id AND m.owner_id=g.owner_id AND m.production=g.revision
 WHERE g.id=? AND g.operator_id=? AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,id,actor.id)
export async function readGrant(env:Bindings,actor:Authority,id:unknown){
 if(typeof id!=='string')fail('exploration_access_required',403)
 const guard=grantGuard(actor,id)
 const row=await env.DB.prepare(`SELECT g.* FROM bf_explore_grants g WHERE g.id=? AND (${guard.sql})`).bind(id,...guard.params??[]).first<Omit<Grant,'definition'>>()
 if(!row)fail('exploration_access_required',403)
 const definition=JSON.parse(row.definition_json) as Definition
 if(sha256(canonicalJson(definition))!==row.digest)fail('exploration_access_changed',409)
 const sources=[]
 for(const ref of definition.sources){const source=await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=? AND revision=?').bind(ref.id,ref.revision).first<{id:string;revision:string;value_json:string}>();if(!source||sha256(source.value_json)!==ref.digest)fail('exploration_source_changed',409);sources.push(sourceMatch({...source,table:JSON.parse(source.value_json)}))}
 await transact(env.DB,actor,[assertion(guard),...sources.map(assertion)])
 return {grant:{...row,definition},guards:[guard,...sources]}
}
export async function accessResponse(request:Request,env:Bindings,actor:Authority,path:string):Promise<Response|null>{
 if(!path.startsWith('/api/operator/explore/access'))return null
 if(actor.role!=='owner')fail('owner_required',403)
 const revoke=/^\/api\/operator\/explore\/access\/([a-f0-9-]{36})\/revoke$/.exec(path)
 if(revoke&&request.method==='POST'){
  const row=await env.DB.prepare('SELECT * FROM bf_explore_grants WHERE id=? AND owner_id=?').bind(revoke[1],actor.id).first<Omit<Grant,'definition'>>()
  if(!row)fail('grant_not_found',404)
  await transact(env.DB,actor,[sql('DELETE FROM bf_explore_activation WHERE grant_id=?',row.id),audit(actor,{...row,definition:JSON.parse(row.definition_json)},'revoked')]);return json({revoked:true},200)
 }
 if(path==='/api/operator/explore/access'&&request.method==='GET'){
  const grants=(await env.DB.prepare('SELECT id,digest,definition_json FROM bf_explore_grants WHERE owner_id=? ORDER BY created_at DESC LIMIT 200').bind(actor.id).all()).results
  const audit=(await env.DB.prepare('SELECT grant_id,digest,actor_id,action,recorded_at FROM bf_explore_audit WHERE owner_id=? ORDER BY recorded_at DESC,id LIMIT 200').bind(actor.id).all()).results
  await transact(env.DB,actor,[]);return json({grants,audit},200)
 }
 if(!['/api/operator/explore/access','/api/operator/explore/access/review'].includes(path)||request.method!=='POST')fail('method_not_allowed',405)
 const input=await jsonBody(request);exactKeys(input,['operatorId','operatorVersion','modelId','revision','viewId','filters','dimensions','underlying','summaryExport','underlyingExport','expiresAt','reviewedDigest'])
 if(typeof input.operatorId!=='string'||input.operatorId===actor.id||!Number.isSafeInteger(input.operatorVersion)||!['underlying','summaryExport','underlyingExport'].every(k=>typeof input[k]==='boolean')||input.underlyingExport&&!input.underlying)fail('explicit_permissions_required',400)
 const expiry=typeof input.expiresAt==='string'?Date.parse(input.expiresAt):NaN
 if(!Number.isFinite(expiry)||new Date(expiry).toISOString()!==input.expiresAt||expiry<=Date.now()||expiry>Date.now()+7*86400000)fail('grant_expiry_required',400)
 const person=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active'").bind(input.operatorId).first<{version:number}>(),owner=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{version:number}>()
 if(!person||person.version!==input.operatorVersion||!owner)fail('membership_changed',409)
 const model=await readModel(env,actor.id,String(input.modelId));if(model.production!==input.revision||!model.production)fail('published_model_changed',409)
 const view=(await readDefinition(env,model.production)).views.find(v=>v.id===input.viewId);if(!view?.query.semantic)fail('governed_view_required',404)
 const candidate=queryInput({...view.query,filters:input.filters}),allowed=new Set(view.query.semantic.dimensions.map(d=>d.column))
 if(candidate.filters.some(f=>!allowed.has(f.column))||!Array.isArray(input.dimensions)||input.dimensions.length>4||!input.dimensions.every(d=>typeof d==='string'&&allowed.has(d)))fail('dimension_not_permitted',403)
 const sources=await readSources(env,view.query)
 const definition:Definition={operatorId:input.operatorId,operatorVersion:person.version,ownerVersion:owner.version,modelId:model.id,revision:model.production,viewId:view.id,filters:candidate.filters,dimensions:input.dimensions as string[],underlying:input.underlying as boolean,summaryExport:input.summaryExport as boolean,underlyingExport:input.underlyingExport as boolean,expiresAt:input.expiresAt as string,sources:sources.map(s=>({id:s.id,revision:s.revision,digest:sha256(s.value_json)}))},digest=sha256(canonicalJson(definition))
 const guards=[modelGuard(model),...sources.map(sourceMatch),sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active')",input.operatorId,person.version)]
 if(path.endsWith('/review')){await transact(env.DB,actor,guards.map(assertion));return json({definition,digest},200)}
 if(input.reviewedDigest!==digest)fail('exact_access_review_required',409)
 const id=randomUUID(),grant:Grant={id,owner_id:actor.id,operator_id:input.operatorId,definition_json:canonicalJson(definition),digest,definition}
 await transact(env.DB,actor,[...guards.map(assertion),sql('INSERT INTO bf_explore_grants(id,owner_id,operator_id,model_id,revision,view_id,definition_json,digest,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,actor.id,input.operatorId,model.id,model.production,view.id,grant.definition_json,digest,input.expiresAt,new Date().toISOString()),sql('INSERT INTO bf_explore_activation(grant_id,owner_version,operator_version) VALUES(?,?,?)',id,owner.version,person.version),audit(actor,grant,'issued')])
 return json({id,digest,definition},201)
}
