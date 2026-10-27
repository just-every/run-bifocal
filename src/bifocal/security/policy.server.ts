import { runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { currentAuthority } from '../catalog/authority.server'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { QueryError, fail } from '../query/types'
import { appendAudit, inspectAudit } from './audit.server'
import { matchesIp, prefix } from './ip'

export type IpPolicy={revision:number;enabled:boolean;prefixes:string[]}
export async function readIpPolicy(env:Bindings):Promise<IpPolicy>{
 const row=await env.DB.prepare('SELECT revision,enabled,prefixes_json FROM bf_security_policy WHERE singleton=1').first<{revision:number;enabled:number;prefixes_json:string}>()
 if(!row)return {revision:0,enabled:false,prefixes:[]}
 const prefixes:unknown=JSON.parse(row.prefixes_json)
 if(!Array.isArray(prefixes)||prefixes.length>64||!prefixes.every(value=>typeof value==='string'&&prefix(value))||row.enabled===1&&!prefixes.length)throw Error('ip_policy_invalid')
 return {revision:row.revision,enabled:row.enabled===1,prefixes}
}
export const policyGuard=(policy:IpPolicy)=>policy.revision===0?sql('NOT EXISTS(SELECT 1 FROM bf_security_policy)'):sql('EXISTS(SELECT 1 FROM bf_security_policy WHERE singleton=1 AND revision=? AND enabled=? AND prefixes_json=?)',policy.revision,policy.enabled?1:0,JSON.stringify(policy.prefixes))
// Cloudflare supplies this header; forwarded chains and client query input never grant admission.
export const clientIp=(request:Request)=>request.headers.get('CF-Connecting-IP')??''
export const ipPermitted=(request:Request,policy:IpPolicy)=>!policy.enabled||matchesIp(clientIp(request),policy.prefixes)
export async function securityResponse(request:Request,original:Bindings):Promise<Response|null>{
 const path=new URL(request.url).pathname
 if(!path.startsWith('/api/operator/security'))return null
 const env=runtimeBindings(original)
 try{
  const actor=await currentAuthority(request,env);if(!actor)fail('authentication_required',401)
  if(actor.role!=='owner')fail('owner_required',403)
  if(path==='/api/operator/security/audit'&&request.method==='GET')return json(await inspectAudit(env,actor))
  if(path!=='/api/operator/security/ip-policy')fail('not_found',404)
  const previous=await readIpPolicy(env)
  if(request.method==='GET'){await transact(env.DB,actor,[assertion(policyGuard(previous))]);return json({...previous,currentIp:clientIp(request)||null})}
  if(request.method!=='PUT')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['previousRevision','enabled','prefixes'])
  if(input.previousRevision!==previous.revision)fail('ip_policy_changed',409)
  if(typeof input.enabled!=='boolean'||!Array.isArray(input.prefixes)||input.prefixes.length>64||!input.prefixes.every(value=>typeof value==='string'&&prefix(value))||input.enabled&&!input.prefixes.length)fail('valid_ip_prefixes_required',400)
  const policy:IpPolicy={revision:previous.revision+1,enabled:input.enabled,prefixes:[...new Set(input.prefixes as string[])]}
  if(!ipPermitted(request,policy))fail('current_ip_must_remain_allowed',400)
  await appendAudit(env,actor,{actorId:actor.id,delegatedCredential:null,tenantId:null,action:'ip-policy-change',outcome:'allowed',scope:{revision:policy.revision,enabled:policy.enabled,prefixCount:policy.prefixes.length}},[
   assertion(policyGuard(previous)),sql('INSERT INTO bf_security_policy(singleton,revision,enabled,prefixes_json) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,prefixes_json=excluded.prefixes_json',policy.revision,policy.enabled?1:0,JSON.stringify(policy.prefixes))])
  return json({...policy,currentIp:clientIp(request)||null})
 }catch(error){return json({error:error instanceof QueryError?error.code:'security_integrity_unavailable'},error instanceof QueryError?error.status:503)}finally{await discardBody(request)}
}
