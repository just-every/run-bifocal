import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { currentAuthority, type Authority } from '../catalog/authority.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'
import { audit, compute, guard, liveGuard, release, review, tenant, transition, withdraw, type Tenant } from './store.server'
import { issue, verify } from './tokens.server'
import { parameters as checkedParameters } from './protocol'
const prefix='/api/operator/portal/tenants'
const activation=(t:Tenant,version:number,digest:string)=>sha256(canonicalJson({tenant:t.id,generation:t.generation,head:t.head,version,digest}))

export async function portalResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(path!==prefix&&!path.startsWith(prefix+'/'))return null
 const env=runtimeBindings(original)
 try {
  const actor=await currentAuthority(request,env)
  if(!actor)fail('sign_in_required',401)
  if(actor.role!=='owner')fail('owner_required',403)
  if(url.search)fail('query_parameters_not_supported',400)
  if(path===prefix){
   if(request.method==='GET'){
    const rows=(await env.DB.prepare("SELECT id,status,generation,head,published FROM bf_portal_tenants WHERE owner_id=? AND status<>'erased' ORDER BY id LIMIT 101").bind(actor.id).all()).results
    if(rows.length>100)fail('tenant_inventory_limit',413)
    await transact(env.DB,actor,[]);return json({tenants:rows,mode:'native-owner-preview'})
   }
   if(request.method!=='POST')fail('method_not_allowed',405)
   exactKeys(await jsonBody(request),[])
   const id=randomUUID(),t:Tenant={id,owner_id:actor.id,status:'draft',generation:1,head:0,published:null}
   await transact(env.DB,actor,[assertion(sql("(SELECT count(*) FROM bf_portal_tenants WHERE owner_id=? AND status<>'erased')<100",actor.id)),sql('INSERT INTO bf_portal_tenants(id,owner_id,created_at) VALUES(?,?,?)',id,actor.id,new Date().toISOString()),audit(t,actor,'provisioned')])
   return json({id,generation:1,status:'draft'},201)
  }
  const match=/^\/([a-f0-9-]{36})(?:\/(review|stages|activate|suspend|rotate|erase|tokens|read|queue|usage|archive|export|releases\/(\d+)|jobs\/([a-f0-9-]{36})\/run))?$/.exec(path.slice(prefix.length))
  if(!match)fail('not_found',404)
  const t=await tenant(env,actor,match[1]),action=match[2]
  if(request.method==='GET'){
   if(!action){await transact(env.DB,actor,[assertion(guard(t))]);return json({id:t.id,status:t.status,generation:t.generation,head:t.head,published:t.published,mode:'native-owner-preview'})}
   if(action==='archive'){
    const releases=(await env.DB.prepare('SELECT version,document_json,digest FROM bf_portal_releases WHERE tenant_id=? ORDER BY version').bind(t.id).all<{version:number;document_json:string;digest:string}>()).results
    const events=(await env.DB.prepare('SELECT action,generation,recorded_at FROM bf_portal_audit WHERE tenant_id=? ORDER BY recorded_at LIMIT 1001').bind(t.id).all()).results
    if(events.length>1000)fail('tenant_archive_limit',413)
    await transact(env.DB,actor,[assertion(guard(t)),audit(t,actor,'archive')]);return json({schema:1,tenantId:t.id,releases:releases.map(r=>({version:r.version,document:JSON.parse(r.document_json),digest:r.digest})),events,scope:'Tenant definitions and preview history; shared source records remain in their source dataset.'})
   }
   if(action==='usage'){
    const usage=await env.DB.prepare('SELECT COALESCE(sum(queries),0) AS queries,COALESCE(sum(exports),0) AS exports FROM bf_portal_usage WHERE tenant_id=?').bind(t.id).first()
    await transact(env.DB,actor,[assertion(guard(t))]);return json({tenantId:t.id,...usage,costEstimate:'unavailable',delivery:'disabled'})
   }
   if(match[3]){
    const v=Number(match[3]),r=await release(env,t,v),run=await compute(env,t.owner_id,r.content.document,{},r.content.sources)
    await transact(env.DB,actor,[assertion(guard(t)),...run.guards.map(assertion),audit(t,actor,'release-preview')])
    return json({version:v,document:r.content.document,preview:run.result,reviewedDigest:activation(t,v,r.digest),previousGeneration:t.generation})
   }
   fail('method_not_allowed',405)
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request)
  if(action==='review'||action==='stages'){
   exactKeys(input,action==='review'?['document']:['document','reviewedDigest'])
   const r=await review(env,t,input.document)
   if(action==='review'){
    await transact(env.DB,actor,[assertion(guard(t)),...r.run.guards.map(assertion),audit(t,actor,'draft-preview')])
    return json({preview:r.run.result,reviewedDigest:r.reviewedDigest})
   }
   if(input.reviewedDigest!==r.reviewedDigest)fail('tenant_review_changed',409)
   const version=t.head+1
   if(version>100)fail('tenant_release_limit',413)
   await transact(env.DB,actor,[assertion(guard(t)),...r.run.guards.map(assertion),sql('INSERT INTO bf_portal_releases VALUES(?,?,?,?)',t.id,version,r.text,r.digest),sql('UPDATE bf_portal_tenants SET head=? WHERE id=?',version,t.id),audit(t,actor,'release-staged')])
   return json({version,previousGeneration:t.generation,reviewedDigest:activation({...t,head:version},version,r.digest),preview:r.run.result},201)
  }
  if(action==='activate'){
   exactKeys(input,['version','previousGeneration','reviewedDigest'])
   if(!Number.isInteger(input.version)||input.previousGeneration!==t.generation)fail('tenant_generation_changed',409)
   const version=Number(input.version),r=await release(env,t,version),run=await compute(env,t.owner_id,r.content.document,{},r.content.sources)
   if(input.reviewedDigest!==activation(t,version,r.digest))fail('tenant_review_changed',409)
   await transact(env.DB,actor,[assertion(guard(t)),...run.guards.map(assertion),...withdraw(t),sql('INSERT OR REPLACE INTO bf_portal_activation VALUES(?,?)',t.id,t.generation+1),sql("UPDATE bf_portal_tenants SET generation=generation+1,status='active',published=? WHERE id=?",version,t.id),audit(t,actor,'release-activated')])
   return json({id:t.id,generation:t.generation+1,published:version,status:'active'})
  }
  if(action==='rotate'||action==='suspend'||action==='erase'){
   exactKeys(input,['previousGeneration','confirmTenant'])
   if(action==='erase'&&input.confirmTenant!==t.id)fail('tenant_erasure_confirmation_required',400)
   return json(await transition(env,actor,t,action,input.previousGeneration))
  }
  if(action==='tokens')return json(await issue(env,actor,t,input),201)
  if(action==='read'||action==='queue'||action==='export'||match[4])return await scopedRequest(request,env,actor,t,match[4]?'export':action!,input,match[4])
  fail('method_not_allowed',405)
 }catch(error){return error instanceof QueryError?json({error:error.code},error.status):json({error:'portal_state_changed',reason:'Review current tenant access and release again.'},409)}
 finally{await discardBody(request)}
}
async function scopedRequest(request:Request,env:Bindings,actor:Authority,t:Tenant,action:string,input:Record<string,unknown>,jobId?:string) {
 const token=verify(request,env,actor,t,action),r=await release(env,t),doc=r.content.document
 let parameters=input
 if(jobId){
  exactKeys(input,[])
  const job=await env.DB.prepare("SELECT parameters_json FROM bf_portal_jobs WHERE id=? AND tenant_id=? AND generation=? AND state='queued'").bind(jobId,t.id,t.generation).first<{parameters_json:string}>()
  if(!job)fail('tenant_job_unavailable',404)
  parameters=JSON.parse(job.parameters_json)
 }
 const normalized=checkedParameters(parameters,doc),key=sha256(canonicalJson(normalized))
 const budget=action==='read'?'queries':'exports',limit=doc.budget[budget]
 const used=await env.DB.prepare('SELECT COALESCE(sum('+budget+'),0) AS n FROM bf_portal_usage WHERE tenant_id=?').bind(t.id).first<{n:number}>()
 if(!jobId&&Number(used?.n??0)>=limit)fail('tenant_budget_exhausted',429)
 // Reserve before analytical execution, so rejected or duplicate requests cannot spend compute.
 await transact(env.DB,actor,[assertion(guard(t)),assertion(liveGuard(t)),assertion(token.guard),
  ...jobId?[assertion(sql("EXISTS(SELECT 1 FROM bf_portal_jobs WHERE id=? AND tenant_id=? AND generation=? AND state='queued')",jobId,t.id,t.generation)),sql("UPDATE bf_portal_jobs SET state='processing' WHERE id=?",jobId)]:[
   assertion(sql('(SELECT COALESCE(sum('+budget+'),0) FROM bf_portal_usage WHERE tenant_id=?)<?',t.id,limit)),
   sql('INSERT INTO bf_portal_usage(tenant_id,generation,'+budget+') VALUES(?,?,1) ON CONFLICT(tenant_id,generation) DO UPDATE SET '+budget+'='+budget+'+1',t.id,t.generation)],
  sql('UPDATE bf_portal_tokens SET used=1 WHERE nonce=?',token.nonce),audit(t,actor,action+'-admitted')])
 const changes=[assertion(guard(t)),assertion(liveGuard(t)),assertion(token.consumedGuard),audit(t,actor,action+'-completed')]
 if(action==='queue'){
  const id=randomUUID();changes.push(sql("INSERT INTO bf_portal_jobs VALUES(?,?,?,?,?,'queued')",id,t.id,t.generation,t.published,canonicalJson(normalized)))
  await transact(env.DB,actor,changes);return json({id,tenantId:t.id,state:'queued',delivery:'disabled'},201)
 }
 if(jobId)changes.push(assertion(sql("EXISTS(SELECT 1 FROM bf_portal_jobs WHERE id=? AND tenant_id=? AND generation=? AND state='processing')",jobId,t.id,t.generation)),sql("UPDATE bf_portal_jobs SET state='completed' WHERE id=?",jobId))
 const run=await compute(env,actor.id,doc,normalized,r.content.sources)
 changes.push(...run.guards.map(assertion))
 const cached=action==='read'?await env.DB.prepare('SELECT result_json FROM bf_portal_cache WHERE tenant_id=? AND generation=? AND key=?').bind(t.id,t.generation,key).first<{result_json:string}>():null
 const cacheMatches=!!cached&&cached.result_json===canonicalJson(run.result)
 const result=cacheMatches?JSON.parse(cached!.result_json):run.result
 if(action==='read'&&!cacheMatches)changes.push(sql('INSERT OR REPLACE INTO bf_portal_cache VALUES(?,?,?,?)',t.id,t.generation,key,canonicalJson(result)))
 await transact(env.DB,actor,changes)
 return json({tenantId:t.id,generation:t.generation,release:t.published,result,cached:cacheMatches,...action==='export'?{format:'json',download:true}:{}})
}
