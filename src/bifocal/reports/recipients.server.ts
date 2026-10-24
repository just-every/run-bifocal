import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'
import { uuid } from '../catalog/protocol'
import { fail } from '../query/types'
import type { Run } from './store.server'

export async function recipientDefinitions(env: Bindings, value: unknown) {
 if (!Array.isArray(value) || value.length > 16 || new Set(value).size !== value.length) fail('bounded_pending_recipients_required',400)
 const definitions: {reviewerId:string;reviewerVersion:number}[] = []
 for (const raw of value) {
  const reviewerId = uuid(raw), member = await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active'").bind(reviewerId).first<{version:number}>()
  if (!member) fail('active_pending_recipient_required',409)
  definitions.push({reviewerId,reviewerVersion:member.version})
 }
 return definitions
}
export const recipientMember = (value: {reviewerId:string;reviewerVersion:number}) => sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?)",value.reviewerId,value.reviewerVersion)
export async function pendingRecipients(env: Bindings, runId: string) {
 return (await env.DB.prepare("SELECT p.reviewer_id AS reviewerId,p.reviewer_version AS reviewerVersion,CASE WHEN o.status='active' AND o.version=p.reviewer_version THEN 1 ELSE 0 END AS active FROM bf_report_pending_recipients p LEFT JOIN oa_operators o ON o.id=p.reviewer_id WHERE p.run_id=? ORDER BY p.reviewer_id").bind(runId).all<{reviewerId:string;reviewerVersion:number;active:number}>()).results.map(value=>({...value,active:!!value.active}))
}
export const pendingGuard = (runId: string) => sql("NOT EXISTS(SELECT 1 FROM bf_report_pending_recipients p LEFT JOIN oa_operators o ON o.id=p.reviewer_id WHERE p.run_id=? AND (o.id IS NULL OR o.status<>'active' OR o.version<>p.reviewer_version))",runId)
export async function fencePending(env: Bindings, actor: Authority, run: Run) {
 const guard = pendingGuard(run.id), valid = await env.DB.prepare('SELECT CASE WHEN ('+guard.sql+') THEN 1 ELSE 0 END AS ok').bind(...guard.params??[]).first<{ok:number}>()
 if (valid?.ok !== 1) {
  if (['queued','rendered','approved'].includes(run.state)) await transact(env.DB,actor,[assertion(sql('EXISTS(SELECT 1 FROM bf_report_runs WHERE id=? AND version=?)',run.id,run.version)),sql("UPDATE bf_report_runs SET state='cancelled',request_json=NULL,artifact_json=NULL,artifact_digest=NULL,approval_json=NULL,version=version+1 WHERE id=?",run.id)])
  fail('pending_recipient_authority_changed',409)
 }
 return guard
}
