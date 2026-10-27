import { exactGrantReview } from '../approvals/grant-review.server'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'
import { uuid } from '../catalog/protocol'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail } from '../query/types'
import { artifactCustody, downloadable, reviewerAccess } from './grant-access.server'
import { grantAudit } from './grant-audit.server'
import { readRun, runGuard, type Run } from './store.server'
export async function reviewerDetails(env: Bindings, actor: Authority, run: Run) {
 const access = reviewerAccess(actor,run.id)
 const grant = await env.DB.prepare(`SELECT g.id,g.expires_at FROM bf_report_reviewer_grants g JOIN bf_report_reviewer_activation a ON a.grant_id=g.id
 JOIN oa_operators o ON o.id=g.owner_id AND o.role='owner' AND o.status='active' AND o.version=g.owner_version AND o.version=a.owner_version
 JOIN oa_operators p ON p.id=g.reviewer_id AND p.status='active' AND p.version=g.reviewer_version AND p.version=a.reviewer_version
 WHERE g.run_id=? AND g.reviewer_id=? AND g.artifact_digest=? AND g.revoked_at IS NULL AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${access.sql}) ORDER BY g.created_at DESC,g.id LIMIT 1`).bind(run.id,actor.id,run.artifact_digest,...access.params??[]).first<{id:string;expires_at:string}>()
 if (!grant) fail('report_not_found',404)
 return {kind:'named-reviewer' as const,readOnly:true,grantId:grant.id,expiresAt:grant.expires_at}
}
export async function reportGrantResponse(request: Request, env: Bindings, actor: Authority, path: string): Promise<Response | null> {
 const match = /^\/([a-f0-9-]{36})\/grants(?:\/([a-f0-9-]{36}))?$/.exec(path)
 if (!match) return null
 if (actor.role !== 'owner') fail('owner_required',403)
 if (new URL(request.url).search) fail('query_parameters_not_supported',400)
 const run = await readRun(env,actor,match[1])
 if (match[2]) {
  if (request.method !== 'DELETE') return json({error:'method_not_allowed'},405)
  const grant = await env.DB.prepare('SELECT reviewer_id FROM bf_report_reviewer_grants WHERE id=? AND run_id=? AND owner_id=?').bind(match[2],run.id,actor.id).first<{reviewer_id:string}>()
  if (!grant) fail('report_grant_not_found',404)
  await transact(env.DB,actor,[assertion(runGuard(run)),sql('UPDATE bf_report_reviewer_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?',new Date().toISOString(),match[2]),sql('DELETE FROM bf_report_reviewer_activation WHERE grant_id=?',match[2]),...grantAudit(actor,run,'grant-revoked',grant.reviewer_id,match[2])])
  return json({id:match[2],revoked:true,immediate:true})
 }
 if (request.method === 'GET') {
  const grants = (await env.DB.prepare(`SELECT g.id,g.reviewer_id AS reviewerId,g.reviewer_version AS reviewerVersion,g.owner_version AS ownerVersion,g.artifact_digest AS digest,g.expires_at AS expiresAt,g.created_at AS createdAt,g.revoked_at AS revokedAt,v.context_json AS reviewJson,
  CASE WHEN g.revoked_at IS NULL AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.artifact_digest=? AND a.reviewer_version=p.version AND a.owner_version=o.version AND g.reviewer_version=p.version AND g.owner_version=o.version AND p.status='active' AND o.status='active' AND o.role='owner' THEN 1 ELSE 0 END AS active
  FROM bf_report_reviewer_grants g LEFT JOIN bf_report_grant_reviews v ON v.grant_id=g.id LEFT JOIN bf_report_reviewer_activation a ON a.grant_id=g.id LEFT JOIN oa_operators p ON p.id=g.reviewer_id LEFT JOIN oa_operators o ON o.id=g.owner_id WHERE g.run_id=? ORDER BY g.created_at,g.id`).bind(run.artifact_digest,run.id).all()).results
  await transact(env.DB,actor,[assertion(runGuard(run))])
  return json({grants:grants.map(grant=>({...grant,review:grant.reviewJson?JSON.parse(String(grant.reviewJson)):null,reviewJson:undefined,active:!!grant.active&&downloadable(run)})),requiresCurrentSession:true})
 }
 if (request.method !== 'POST') return json({error:'method_not_allowed'},405)
 const input = await jsonBody(request); exactKeys(input,['reviewerId','reviewerVersion','digest','previousVersion','expiresAt','classificationRevisions'])
 const reviewerId = uuid(input.reviewerId)
 if (reviewerId === actor.id || !Number.isSafeInteger(input.reviewerVersion) || input.previousVersion !== run.version || input.digest !== run.artifact_digest || !downloadable(run)) fail('exact_reviewer_artifact_review_required',409)
 const expiry = typeof input.expiresAt === 'string' ? Date.parse(input.expiresAt) : NaN, now = Date.now()
 if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== input.expiresAt || expiry <= now || expiry > now + 7*86400000 || run.retain_until && expiry > Date.parse(run.retain_until)) fail('reviewer_grant_expiry_required',400)
 const reviewer = await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active'").bind(reviewerId).first<{version:number}>(), owner = await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{version:number}>()
 if (!reviewer || reviewer.version !== input.reviewerVersion || !owner) fail('reviewer_membership_changed',409)
 const reviewed=await exactGrantReview(env,actor,run,reviewerId,reviewer.version,input.expiresAt as string,input.classificationRevisions)
 const guards = await artifactCustody(env,actor,run), id = randomUUID(), createdAt = new Date().toISOString()
 await transact(env.DB,actor,[assertion(runGuard(run)),...guards.map(assertion),...reviewed.guards.map(assertion),assertion(sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?)",reviewerId,reviewer.version)),sql('INSERT INTO bf_report_reviewer_grants(id,run_id,owner_id,reviewer_id,artifact_digest,owner_version,reviewer_version,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,run.id,actor.id,reviewerId,run.artifact_digest,owner.version,reviewer.version,input.expiresAt,createdAt),sql('INSERT INTO bf_report_reviewer_activation(grant_id,owner_version,reviewer_version,activated_at) VALUES(?,?,?,?)',id,owner.version,reviewer.version,createdAt),sql('INSERT INTO bf_report_grant_reviews(grant_id,context_json) VALUES(?,?)',id,canonicalJson(reviewed.context)),...grantAudit(actor,run,'grant-issued',reviewerId,id)])
 return json({id,runId:run.id,reviewerId,digest:run.artifact_digest,expiresAt:input.expiresAt,requiresCurrentSession:true,review:reviewed.context,grantsDeliveryAuthority:false},201)
}
