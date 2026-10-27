import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Authority } from '../catalog/authority.server'
import { certifiedReportMetric } from '../catalog/certification.server'
import { readQuery } from '../data/snapshots/store'
import { fail } from '../query/types'
import { fencePending, pendingRecipients } from '../reports/recipients.server'
import { freshness, reportAudit, runGuard, type Run } from '../reports/store.server'
import { classificationBindings } from './classifications.server'

type Review = {id:string;run_id:string;actor_id:string;context_json:string;fingerprint:string;expires_at:string;approved_at:string|null}

/** Classification describes the audience. Only the current native owner has
 * approval authority at this bounded door; classification grants no access. */
async function reviewContext(env: Bindings, actor: Authority, run: Run, expiresAt: string) {
 if (actor.role !== 'owner' || actor.id !== run.owner_id) fail('owner_required',403)
 if (!run.artifact_json || !run.snapshot_id || !run.artifact_digest) fail('exact_retained_report_review_required',409)
 const artifact = JSON.parse(run.artifact_json), pending = await fencePending(env,actor,run)
 const recipients = await pendingRecipients(env,run.id)
 const bindings = await classificationBindings(env,[...new Set([actor.id,...recipients.map(p=>p.reviewerId)])].sort())
 const owner = await env.DB.prepare("SELECT version,email FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{version:number;email:string}>()
 if (!owner) fail('owner_required',401)
 const {snapshot,sources,guard} = await readQuery(env,actor,run.owner_id,run.snapshot_id), current = await freshness(env,sources)
 const metric = await certifiedReportMetric(env,actor,artifact.metricRef,snapshot.definition)
 if (canonicalJson(current.cutoffs) !== canonicalJson(artifact.observedSources)) fail('source_changed_after_render_create_revision',409)
 const context = {
  runId:run.id, artifactRevision:run.revision, digest:run.artifact_digest,
  query:{id:snapshot.queryId,digest:snapshot.digest,definition:snapshot.definition},
  metric:metric.reference, definitionVersions:artifact.definitionVersions,
  sourceContext:artifact.observedSources, securityContext:artifact.securityScope,
  approver:{id:actor.id,version:owner.version}, classifications:bindings.references,
  audience:artifact.audience, recipientReferences:recipients.map(p=>({id:p.reviewerId,version:p.reviewerVersion})),
  destination:{kind:'existing-owner-email',recipientId:actor.id,address:owner.email}, format:'application/json',
  action:'existing-native-report-instance', expiresAt,
 }
 return {context,guards:[guard,pending,metric.guard,...current.guards,...bindings.guards,
  sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND version=? AND email=?)",actor.id,owner.version,owner.email)]}
}
export async function prepareInstanceReview(env: Bindings, actor: Authority, run: Run, expiresAt: unknown) {
 if (run.state !== 'rendered') fail('rendered_report_required',409)
 const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN
 if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== expiresAt || expiry <= Date.now() || expiry > Date.now()+7*86400000 || run.retain_until && expiry > Date.parse(run.retain_until)) fail('instance_review_expiry_required',400)
 const {context,guards} = await reviewContext(env,actor,run,expiresAt as string)
 const id=randomUUID(), body=canonicalJson(context), fingerprint=sha256(body)
 await transact(env.DB,actor,[assertion(runGuard(run)),...guards.map(assertion),
  sql('INSERT INTO bf_report_instance_reviews(id,run_id,actor_id,context_json,fingerprint,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',id,run.id,actor.id,body,fingerprint,expiresAt,new Date().toISOString()),
  sql('INSERT INTO bf_report_review_activation(review_id) VALUES(?)',id),reportAudit(actor,run,'instance-reviewed')])
 return {id,fingerprint,context,previousVersion:run.version,grantsViewingAuthority:false,grantsDeliveryAuthority:false}
}
export async function checkedInstanceReview(env: Bindings, actor: Authority, run: Run, id: unknown, approved: boolean) {
 if (typeof id !== 'string') fail('exact_instance_review_required',409)
 const review=await env.DB.prepare('SELECT * FROM bf_report_instance_reviews WHERE id=? AND run_id=? AND actor_id=?').bind(id,run.id,actor.id).first<Review>()
 if (!review || Date.parse(review.expires_at)<=Date.now() || !!review.approved_at!==approved) fail('instance_review_expired_or_used',409)
 const current=await reviewContext(env,actor,run,review.expires_at)
 if (canonicalJson(current.context)!==review.context_json || sha256(review.context_json)!==review.fingerprint) fail('instance_review_changed',409)
 const active=sql("EXISTS(SELECT 1 FROM bf_report_instance_reviews r JOIN bf_report_review_activation a ON a.review_id=r.id WHERE r.id=? AND r.run_id=? AND r.actor_id=? AND r.context_json=? AND r.fingerprint=? AND r.approved_at IS ? AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",id,run.id,actor.id,review.context_json,review.fingerprint,review.approved_at)
 if (!(await env.DB.prepare('SELECT 1 WHERE ('+active.sql+')').bind(...active.params??[]).first())) fail('instance_review_inactive',409)
 return {review,guards:[active,...current.guards]}
}
