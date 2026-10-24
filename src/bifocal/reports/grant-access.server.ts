import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'
import { readQuery } from '../data/snapshots/store'
import { fail } from '../query/types'
import type { Run } from './store.server'

export const downloadable = (run: Run) => !!run.artifact_json && ['approved','accepted','development'].includes(run.state) && (!run.retain_until || Date.parse(run.retain_until) > Date.now())
export const reviewerAccess = (actor: Authority, runId: string, grantId: string | null = null) => sql(`EXISTS(
 SELECT 1 FROM bf_report_reviewer_grants g JOIN bf_report_reviewer_activation a ON a.grant_id=g.id
 JOIN bf_report_runs r ON r.id=g.run_id
 JOIN oa_operators o ON o.id=g.owner_id AND o.role='owner' AND o.status='active' AND o.version=a.owner_version AND o.version=g.owner_version
 JOIN oa_operators p ON p.id=g.reviewer_id AND p.status='active' AND p.version=a.reviewer_version AND p.version=g.reviewer_version
 WHERE r.id=? AND r.owner_id=g.owner_id AND g.reviewer_id=? AND (? IS NULL OR g.id=?) AND g.revoked_at IS NULL AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND g.artifact_digest=r.artifact_digest AND r.artifact_json IS NOT NULL AND r.snapshot_id IS NOT NULL
 AND r.state IN ('approved','accepted','development') AND (r.retain_until IS NULL OR r.retain_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`,runId,actor.id,grantId,grantId)

/** A grant lends one exact owner's artifact, never source or query authority.
 * Retained dated values may be stale, but every source must still be in custody. */
export async function artifactCustody(env: Bindings, actor: Authority, run: Run) {
 if (!run.artifact_json || !run.artifact_digest || !run.snapshot_id || run.retain_until && Date.parse(run.retain_until) <= Date.now()) fail('report_withdrawn_or_retention_expired',410)
 const owner = await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(run.owner_id).first<{ version: number }>()
 if (!owner) fail('report_not_found',404)
 const { guard, sources } = await readQuery(env, actor, run.owner_id, run.snapshot_id)
 const guards = [guard,sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND version=?)",run.owner_id,owner.version)]
 for (const source of sources) {
  if (!await env.DB.prepare('SELECT 1 FROM bf_file_tables WHERE id=?').bind(source.id).first()) fail('report_withdrawn_or_retention_expired',410)
  guards.push(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?)',source.id))
 }
 if (actor.id !== run.owner_id || actor.role !== 'owner') guards.push(reviewerAccess(actor, run.id))
 return guards
}
