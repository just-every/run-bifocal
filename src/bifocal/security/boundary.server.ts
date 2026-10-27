import { runtimeBindings, type Bindings } from '../../auth.server'
import { sql, transact, assertion } from '../../modules/import-kit/src/door/store.ts'
import { currentAuthority } from '../catalog/authority.server'
import { discardBody, json } from '../models/validation/transport'
import { appDocument, appPolicy } from '../../app/shell'
import { appendAudit, queryNote } from './audit.server'
import { ipPermitted, readIpPolicy, policyGuard } from './policy.server'

function refusal(request:Request,status:number,code:string):Response {
 if(!request.headers.get('accept')?.includes('text/html'))return json({error:code},status)
 return new Response(appDocument({title:'Access unavailable · Bifocal',viewer:null,place:'settings',main:`<div class="pagehead"><h1>Access unavailable</h1></div><p role="alert">${code==='ip_not_allowed'?'This network address is outside the installation’s IP allowlist. Connect from an approved network.':'Security controls could not be verified. Try again or contact the installation owner.'}</p>`}),{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}`}})
}
/** Admission precedes native auth, private HTML, API and every product router. */
export async function securityBoundary(request:Request,original:Bindings,next:()=>Promise<Response>):Promise<Response>{
 const path=new URL(request.url).pathname
 if(!/^\/(app|api|auth|setup)(\/|$)/.test(path))return next()
 const env=runtimeBindings(original)
 try{
  const policy=await readIpPolicy(env)
  if(!ipPermitted(request,policy)){await appendAudit(env,sql('1'),{actorId:null,delegatedCredential:null,tenantId:null,action:'ip-admission',outcome:'refused'},[assertion(policyGuard(policy))]);await discardBody(request);return refusal(request,403,'ip_not_allowed')}
  const audited=/^\/api\/operator\/(queries|explore|dashboards|reports)(\/|$)/.test(path)
  const actor=audited?await currentAuthority(request,env):null
  const response=await next()
  // A policy edit while execution was in flight wins before any response leaves.
  const current=await readIpPolicy(env)
  if(!ipPermitted(request,current)){await response.body?.cancel();return refusal(request,403,'ip_not_allowed')}
  if(audited){
   const reference=/^\/api\/operator\/(?:queries|explore)\/([a-f0-9-]{36})(?:\/|$)/.exec(path)?.[1]
   const note=queryNote(request)??(reference?{queryId:reference}:undefined),segment=path.split('/').at(-1)??'',action=['export','full-export','export-snapshot'].includes(segment)?'export':segment==='export-plan'?'export-plan':request.method==='GET'||segment==='page'?'view':segment==='run'||segment==='rerun'?'query':'definition-change'
   // A native refusal contains no analytical result. Retain its observed actor
   // after session revocation without authorizing any data read or mutation.
   const refused=[400,401,403,404,405,409,410,422].includes(response.status)
   await appendAudit(env,refused?sql('1'):actor??sql('1'),{actorId:actor?.id??null,delegatedCredential:null,tenantId:null,action,outcome:response.ok?'allowed':'refused',httpStatus:response.status,...note??{},...note&&'scope' in note?{scope:{...note.scope,exportRows:response.headers.has('x-bifocal-row-count')?Number(response.headers.get('x-bifocal-row-count')):null}}:{}},[assertion(policyGuard(current))])
  }else await transact(env.DB,sql('1'),[assertion(policyGuard(current))])
  return response
 }catch{return refusal(request,503,'security_integrity_unavailable')}
}
