import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail } from '../query/types'
import type { Authority } from '../catalog/authority.server'
export async function issueDownload(env:Bindings,actor:Authority,run:{id:string;owner_id:string;state:string;version:number;artifact_json:string|null;retain_until:string|null},expiresAt:unknown){
 // No derived publication grant is inferred from membership or an audience name.
 // The current ruled owner-only snapshot scope remains intact.
 if(actor.id!==run.owner_id||actor.role!=='owner')fail('report_not_found',404)
 if(!run.artifact_json||!['accepted','development','approved'].includes(run.state))fail('report_not_downloadable',410)
 const expiry=typeof expiresAt==='string'?Date.parse(expiresAt):NaN,now=Date.now()
 if(!Number.isFinite(expiry)||expiry<=now||expiry>now+900000||run.retain_until&&expiry>Date.parse(run.retain_until))fail('download_expiry_required',400)
 const token=Buffer.from(randomBytes(32)).toString('base64url')
 await transact(env.DB,actor,[assertion(sql('EXISTS(SELECT 1 FROM bf_report_runs WHERE id=? AND owner_id=? AND version=? AND artifact_json IS NOT NULL)',run.id,actor.id,run.version)),sql('INSERT INTO bf_report_downloads(token_hash,run_id,operator_id,expires_at,created_at) VALUES(?,?,?,?,?)',sha256(token),run.id,actor.id,new Date(expiry).toISOString(),new Date().toISOString())])
 return {url:'/api/operator/report-runs/'+run.id+'/download?token='+token,expiresAt:new Date(expiry).toISOString(),requiresCurrentSession:true}
}
export async function downloadReport(env:Bindings,actor:Authority,run:{id:string;owner_id:string;artifact_json:string|null;artifact_digest:string|null;retain_until:string|null;version:number},token:string|null){
 if(actor.id!==run.owner_id||actor.role!=='owner')fail('report_not_found',404)
 if(!token||!/^[a-zA-Z0-9_-]{43}$/.test(token))fail('download_expired_or_revoked',410)
 if(!run.artifact_json||run.retain_until&&Date.parse(run.retain_until)<=Date.now())fail('report_withdrawn_or_retention_expired',410)
 const hash=sha256(token),guard=sql("EXISTS(SELECT 1 FROM bf_report_downloads WHERE token_hash=? AND run_id=? AND operator_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",hash,run.id,actor.id)
 // EXISTS is a scalar expression, so query it explicitly rather than treating
 // a row containing false as a successful grant.
 const valid=await env.DB.prepare('SELECT CASE WHEN ('+guard.sql+') THEN 1 ELSE 0 END AS ok').bind(...guard.params??[]).first<{ok:number}>()
 if(valid?.ok!==1)fail('download_expired_or_revoked',410)
 await transact(env.DB,actor,[assertion(guard),assertion(sql('EXISTS(SELECT 1 FROM bf_report_runs WHERE id=? AND owner_id=? AND version=? AND artifact_digest=? AND artifact_json=?)',run.id,actor.id,run.version,run.artifact_digest,run.artifact_json))])
 return new Response(run.artifact_json,{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="bifocal-report-${run.id}.json"`,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}})
}
