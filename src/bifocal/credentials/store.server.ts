import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { currentAuthority, type Authority } from '../catalog/authority.server'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { readModel, readDefinition, modelGuard } from '../models/validation/store.server'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { sourceRules, intersectSources, sourceRuleResponse } from './sources.server'
import { queryInput } from '../query/validate'
import { fail, type Filter } from '../query/types'
export type Scope={purpose:string;modelId:string;revision:string;viewId:string;filters:Filter[];dimensions:string[];measures:string[];tools:string[];expiresAt:string;maxOperations:number;sources:{id:string;revision:string;digest:string;policyDigest?:string;policyVersion?:number}[]}
export type Credential={id:string;owner_id:string;owner_version:number;definition_json:string;digest:string;expires_at:string;max_operations:number;used_operations:number;scope:Scope}
const hash=(env:Bindings,token:string)=>{
 if(!env.INSTALLATION_KEY)fail('credential_custody_unavailable',503)
 return createHmac('sha256',env.INSTALLATION_KEY).update(env.AUTH_ORIGIN+'\n'+token).digest('hex')
}
export const machineAudit=(id:string,owner:string,kind:'human'|'machine',action:string)=>sql('INSERT INTO bf_machine_audit(id,credential_id,owner_id,actor_kind,action,recorded_at) VALUES(?,?,?,?,?,?)',randomUUID(),id,owner,kind,action,new Date().toISOString())
export const credentialGuard=(c:Credential)=>sql(`EXISTS(SELECT 1 FROM bf_machine_credentials c JOIN oa_operators o ON o.id=c.owner_id
 WHERE c.id=? AND c.digest=? AND c.revoked=0 AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND o.status='active' AND o.role='owner' AND o.version=c.owner_version)`,c.id,c.digest)
export async function machineAuthority(request:Request,env:Bindings){
 const url=new URL(request.url)
 if(url.origin!==env.AUTH_ORIGIN||request.headers.get('sec-fetch-site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.AUTH_ORIGIN)fail('credential_required',401)
 const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')??'')?.[1]
 if(!token)fail('credential_required',401)
 const row=await env.DB.prepare('SELECT id,owner_id,owner_version,definition_json,digest,expires_at,max_operations,used_operations FROM bf_machine_credentials WHERE token_hash=?').bind(hash(env,token)).first<Omit<Credential,'scope'>>()
 if(!row)fail('credential_required',401)
 const credential={...row,scope:JSON.parse(row.definition_json) as Scope}
 if(sha256(canonicalJson(credential.scope))!==credential.digest)fail('credential_required',401)
 const guard=credentialGuard(credential)
 if(!(await env.DB.prepare(`SELECT 1 AS ok WHERE (${guard.sql})`).bind(...guard.params??[]).first()))fail('credential_required',401)
 return {credential,authority:{...guard,id:row.owner_id,email:'',role:'owner'} as Authority}
}
export async function credentialResponse(request:Request,env:Bindings):Promise<Response|null>{
 const path=new URL(request.url).pathname
 if(!/^\/api\/operator\/credentials(?:\/|$)/.test(path))return null
 if(request.headers.has('authorization'))fail('human_session_required',403)
 const actor=await currentAuthority(request,env)
 if(!actor||actor.role!=='owner')fail('owner_required',401)
 if(new URL(request.url).search)fail('unsupported_input',400)
 const sourceResponse=await sourceRuleResponse(request,env,actor,path);if(sourceResponse)return sourceResponse
 if(path==='/api/operator/credentials'&&request.method==='GET'){
  const credentials=(await env.DB.prepare('SELECT id,definition_json,digest,used_operations,revoked FROM bf_machine_credentials WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 100').bind(actor.id).all()).results
  const history=(await env.DB.prepare('SELECT credential_id,actor_kind,action,recorded_at FROM bf_machine_audit WHERE owner_id=? ORDER BY recorded_at DESC,id LIMIT 200').bind(actor.id).all()).results
  await transact(env.DB,actor,[]);return json({credentials,history})
 }
 const revoke=/^\/api\/operator\/credentials\/([a-f0-9-]{36})\/revoke$/.exec(path)
 if(revoke&&request.method==='POST'){
  exactKeys(await jsonBody(request),[])
  await transact(env.DB,actor,[assertion(sql('EXISTS(SELECT 1 FROM bf_machine_credentials WHERE id=? AND owner_id=?)',revoke[1],actor.id)),sql('UPDATE bf_machine_credentials SET revoked=1 WHERE id=? AND owner_id=?',revoke[1],actor.id),machineAudit(revoke[1],actor.id,'human','revoked')]);return json({revoked:true})
 }
 if(!['/api/operator/credentials','/api/operator/credentials/review'].includes(path)||request.method!=='POST')fail('method_not_allowed',405)
 const input=await jsonBody(request)
 exactKeys(input,['purpose','modelId','revision','viewId','filters','dimensions','measures','tools','expiresAt','maxOperations','reviewedDigest'])
 if(typeof input.purpose!=='string'||!input.purpose.trim()||input.purpose.length>120)fail('purpose_required',400)
 const expiry=typeof input.expiresAt==='string'?Date.parse(input.expiresAt):NaN
 if(!Number.isFinite(expiry)||new Date(expiry).toISOString()!==input.expiresAt||expiry<=Date.now()||expiry>Date.now()+86400000)fail('expiry_within_one_day_required',400)
 if(!Number.isSafeInteger(input.maxOperations)||Number(input.maxOperations)<1||Number(input.maxOperations)>1000)fail('bounded_operation_budget_required',400)
 const tools=input.tools
 if(!Array.isArray(tools)||!tools.length||tools.length>2||new Set(tools).size!==tools.length||tools.some(t=>!['definitions','query'].includes(t)))fail('read_tools_required',400)
 const model=await readModel(env,actor.id,String(input.modelId))
 if(!model.production||model.production!==input.revision)fail('published_model_changed',409)
 const view=(await readDefinition(env,model.production)).views.find(v=>v.id===input.viewId)
 if(!view?.query.semantic)fail('governed_view_required',404)
 const dimensions=input.dimensions,measures=input.measures
 if(!Array.isArray(dimensions)||dimensions.length>4||!dimensions.every(d=>typeof d==='string'&&view.query.semantic!.dimensions.some(v=>v.column===d))||new Set(dimensions).size!==dimensions.length)fail('dimension_not_permitted',403)
 if(!Array.isArray(measures)||!measures.length||!measures.every(m=>typeof m==='string'&&view.query.measures.some(v=>v.id===m))||new Set(measures).size!==measures.length)fail('measure_not_permitted',403)
 const filters=queryInput({...view.query,filters:input.filters}).filters
 if(filters.some(f=>!dimensions.includes(f.column)))fail('dimension_not_permitted',403)
 const sources=await readSources(env,view.query),owner=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active' AND role='owner'").bind(actor.id).first<{version:number}>()
 if(!owner)fail('owner_required',401)
 const rules=await sourceRules(env,sources)
 intersectSources({...view.query,groupBy:dimensions as string[],filters:[...view.query.filters,...view.rowRules,...filters],measures:view.query.measures.filter(m=>measures.includes(m.id))},rules)
 const scope:Scope={purpose:input.purpose.trim(),modelId:model.id,revision:model.production,viewId:view.id,filters,dimensions,measures,tools,expiresAt:input.expiresAt as string,maxOperations:Number(input.maxOperations),sources:rules.map(r=>({id:r.source.id,revision:r.source.revision,digest:sha256(r.source.value_json),...r.digest?{policyDigest:r.digest,policyVersion:r.version}:{}}))}
 const digest=sha256(canonicalJson({scope,ownerId:actor.id,ownerVersion:owner.version,origin:env.AUTH_ORIGIN}))
 // Stored digest covers the immutable scope; the review also binds current human authority.
 const scopeDigest=sha256(canonicalJson(scope)),guards=[modelGuard(model),...sources.map(sourceMatch),...rules.map(r=>r.guard),sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role='owner' AND status='active')",actor.id,owner.version)]
 if(path.endsWith('/review')){await transact(env.DB,actor,guards.map(assertion));return json({scope,digest})}
 if(input.reviewedDigest!==digest)fail('exact_credential_review_required',409)
 const token=Array.from(randomBytes(32),b=>b.toString(16).padStart(2,'0')).join(''),id=randomUUID()
 await transact(env.DB,actor,[...guards.map(assertion),sql('INSERT INTO bf_machine_credentials(id,owner_id,owner_version,token_hash,definition_json,digest,expires_at,max_operations,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,actor.id,owner.version,hash(env,token),canonicalJson(scope),scopeDigest,scope.expiresAt,scope.maxOperations,new Date().toISOString()),machineAudit(id,actor.id,'human','issued-exact-review')])
 return json({id,token,scope,digest:scopeDigest},201)
}

/** Recognized revoked or expired keys may append a redacted security fact, never
 * read data or recover authority. Unknown bearer material is not retained. */
export async function recordMachineRefusal(request:Request,env:Bindings){
 const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')??'')?.[1]
 if(!token||!env.INSTALLATION_KEY)return
 const tokenHash=hash(env,token),row=await env.DB.prepare('SELECT id,owner_id FROM bf_machine_credentials WHERE token_hash=?').bind(tokenHash).first<{id:string;owner_id:string}>()
 if(!row)return
 await transact(env.DB,sql('EXISTS(SELECT 1 FROM bf_machine_credentials WHERE id=? AND token_hash=?)',row.id,tokenHash),[machineAudit(row.id,row.owner_id,'machine','denied')])
}
