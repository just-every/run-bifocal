import { operatorAuth, type Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
export type Authority=D1Sql & {id:string;email:string;role:string}
/** Native session validity, IdP custody and current membership are checked again
 * by D1 inside every data read and write, including a queued/report read. */
export async function currentAuthority(request:Request,env:Bindings):Promise<Authority|null>{
 const url=new URL(request.url)
 if(url.origin!==env.AUTH_ORIGIN || request.headers.has('Host')&&request.headers.get('Host')?.toLowerCase()!==url.host.toLowerCase() || request.headers.get('sec-fetch-site')==='cross-site' || !['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==env.AUTH_ORIGIN)return null
 const session=await operatorAuth(env).getSession(request)
 if(!session)return null
 return {id:session.operator.id,email:session.operator.email,role:session.operator.role,
  sql:`EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND s.operator_id=? AND s.revoked_at IS NULL
   AND s.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND s.operator_version=o.version AND o.version=? AND o.status='active' AND o.role=?
   AND (s.kind!='oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings a ON a.singleton=1 AND a.idp_sign_in=1 AND a.generation=p.generation WHERE p.session_id=s.id))
   AND NOT EXISTS(SELECT 1 FROM oa_provider_session_pins p WHERE p.session_id=s.id AND NOT EXISTS(SELECT 1 FROM oa_identity_providers i WHERE i.provider_id=p.provider_id AND i.status='linked' AND i.issuer=p.issuer AND i.client_id=p.client_id AND i.linked_at=p.linked_at)))`,params:[session.id,session.operator.id,session.operator.version,session.operator.role]}
}
export const itemAccess=(actor:Authority,alias='i'):D1Sql=>({sql:`(${alias}.owner_id=? OR EXISTS(SELECT 1 FROM bf_catalog_grants g JOIN bf_catalog_grant_activation a ON a.kind='item' AND a.resource_id=g.item_id AND a.operator_id=g.operator_id JOIN oa_operators o ON o.id=g.operator_id AND o.status='active' AND o.version=a.operator_version WHERE g.item_id=${alias}.id AND g.operator_id=?))`,params:[actor.id,actor.id]})
