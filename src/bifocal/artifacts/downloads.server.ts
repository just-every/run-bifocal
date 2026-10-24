import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail } from '../query/types'
import type { Authority } from '../catalog/authority.server'
import { artifactCustody, downloadable, reviewerAccess } from '../reports/grant-access.server'
import { grantAudit } from '../reports/grant-audit.server'
import { reviewerDetails } from '../reports/grants.server'
import type { Run } from '../reports/store.server'
export async function issueDownload(env:Bindings,actor:Authority,run:Run,expiresAt:unknown){
 if(actor.id!==run.owner_id||actor.role!=='owner')fail('report_not_found',404)
 if(!downloadable(run))fail('report_not_downloadable',410)
 const custody=await artifactCustody(env,actor,run)
 const expiry=typeof expiresAt==='string'?Date.parse(expiresAt):NaN,now=Date.now()
 if(!Number.isFinite(expiry)||expiry<=now||expiry>now+900000||run.retain_until&&expiry>Date.parse(run.retain_until))fail('download_expiry_required',400)
 const token=Buffer.from(randomBytes(32)).toString('base64url')
 await transact(env.DB,actor,[...custody.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_report_runs WHERE id=? AND owner_id=? AND version=? AND artifact_json IS NOT NULL)',run.id,actor.id,run.version)),sql('INSERT INTO bf_report_downloads(token_hash,run_id,operator_id,expires_at,created_at) VALUES(?,?,?,?,?)',sha256(token),run.id,actor.id,new Date(expiry).toISOString(),new Date().toISOString()),...grantAudit(actor,run,'download-link-issued')])
 return {url:'/api/operator/report-runs/'+run.id+'/download?token='+token,expiresAt:new Date(expiry).toISOString(),requiresCurrentSession:true}
}
export async function downloadReport(env:Bindings,actor:Authority,run:Run,token:string|null){
 const owner=actor.id===run.owner_id&&actor.role==='owner'
 if(!run.artifact_json||run.retain_until&&Date.parse(run.retain_until)<=Date.now())fail('report_withdrawn_or_retention_expired',410)
 if(!downloadable(run))fail('report_not_downloadable',410)
 const guards=await artifactCustody(env,actor,run)
 let grantId:string|null=null
 if(owner&&token!==null){
  if(!/^[a-zA-Z0-9_-]{43}$/.test(token))fail('download_expired_or_revoked',410)
  const guard=sql("EXISTS(SELECT 1 FROM bf_report_downloads WHERE token_hash=? AND run_id=? AND operator_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",sha256(token),run.id,actor.id)
  const valid=await env.DB.prepare('SELECT CASE WHEN ('+guard.sql+') THEN 1 ELSE 0 END AS ok').bind(...guard.params??[]).first<{ok:number}>()
  if(valid?.ok!==1)fail('download_expired_or_revoked',410)
  guards.push(guard)
 }else if(!owner){grantId=(await reviewerDetails(env,actor,run)).grantId;guards.push(reviewerAccess(actor,run.id,grantId))}
 // The native session, exact grant, current owner, source custody and bytes are
 // fenced atomically with the download audit. A URL token is never authority.
 await transact(env.DB,actor,[...guards.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_report_runs WHERE id=? AND owner_id=? AND version=? AND artifact_digest=? AND artifact_json=?)',run.id,run.owner_id,run.version,run.artifact_digest,run.artifact_json)),...grantAudit(actor,run,'artifact-downloaded',actor.id,grantId)])
 return new Response(run.artifact_json,{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="bifocal-report-${run.id}.json"`,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}})
}
