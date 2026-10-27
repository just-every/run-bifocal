import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'
import { fail } from '../query/types'
import { guard, liveGuard, audit, type Tenant } from './store.server'
const mac=(env:Bindings,text:string)=>{
 if(!env.INSTALLATION_KEY)fail('portal_signing_unavailable',503)
 return createHmac('sha256',env.INSTALLATION_KEY).update('bifocal-portal-preview-v1\n'+env.AUTH_ORIGIN+'\n'+text).digest('base64url')
}
export async function issue(env:Bindings,actor:Authority,t:Tenant,input:Record<string,unknown>) {
 if(Object.keys(input).some(k=>!['audience','ttlSeconds','action'].includes(k))||input.audience!==env.AUTH_ORIGIN||!Number.isInteger(input.ttlSeconds)||Number(input.ttlSeconds)<1||Number(input.ttlSeconds)>300||!['read','queue','export'].includes(String(input.action)))fail('portal_token_request_invalid',400)
 if(t.status!=='active'||!t.published)fail('tenant_not_active',403)
 const exp=Date.now()+Number(input.ttlSeconds)*1000,nonce=randomUUID(),text=Buffer.from(canonicalJson({v:1,tenant:t.id,generation:t.generation,owner:actor.id,aud:env.AUTH_ORIGIN,exp,nonce,action:input.action})).toString('base64url'),token=text+'.'+mac(env,text)
 await transact(env.DB,actor,[assertion(guard(t)),assertion(liveGuard(t)),sql('DELETE FROM bf_portal_tokens WHERE expires_at<=? AND tenant_id=?',Date.now(),t.id),sql('INSERT INTO bf_portal_tokens(nonce,tenant_id,generation,expires_at) VALUES(?,?,?,?)',nonce,t.id,t.generation,exp),audit(t,actor,'token-issued')])
 return {token,expiresAt:new Date(exp).toISOString(),singleUse:true,mode:'native-owner-preview'}
}
/** Tokens never replace native owner authentication while customer policy is unruled. */
export function verify(request:Request,env:Bindings,actor:Authority,t:Tenant,action:string) {
 const header=request.headers.get('Authorization')
 if(!header||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header))fail('portal_token_invalid',403)
 const parts=header.slice(7).split('.')
 if(!parts||parts.length!==2||parts[0].length>2048||parts[1].length!==43)fail('portal_token_invalid',403)
 const expected=mac(env,parts[0]),left=Buffer.from(parts[1]),right=Buffer.from(expected)
 if(left.length!==right.length||!timingSafeEqual(left,right))fail('portal_token_invalid',403)
 let p:Record<string,unknown>
 try{p=JSON.parse(Buffer.from(parts[0],'base64url').toString())}catch{fail('portal_token_invalid',403)}
 if(!p||p.v!==1||p.tenant!==t.id||p.generation!==t.generation||p.owner!==actor.id||p.aud!==env.AUTH_ORIGIN||typeof p.exp!=='number'||p.exp<=Date.now()||typeof p.nonce!=='string'||p.action!==action||t.status!=='active')fail('portal_token_invalid',403)
 const tokenGuard=(used:number)=>sql("EXISTS(SELECT 1 FROM bf_portal_tokens WHERE nonce=? AND tenant_id=? AND generation=? AND used=? AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))",p.nonce,t.id,t.generation,used)
 return {nonce:p.nonce,guard:tokenGuard(0),consumedGuard:tokenGuard(1)}
}
