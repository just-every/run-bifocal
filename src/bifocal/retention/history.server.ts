import type { Bindings } from '../../auth.server'
import { guarded, sql, type Authority } from '../company/store'

/** Read only forward records. Older anonymous events cannot establish an owner
 * approval and are never backfilled or rewritten as attributed history. */
export async function protectionHistory(env: Bindings, owner: Authority, dataset: string) {
 const [history] = await guarded(env, owner, [sql(`SELECT r.*,a.recorded_at
  FROM bf_retention_acknowledgments r JOIN bf_erasure_audit a ON a.id=r.audit_id
  WHERE r.dataset_id=? ORDER BY a.recorded_at,r.rowid`, dataset)])
 return { history, scope: 'Forward protection reviews only. Earlier anonymous audits cannot establish an attributed review. Eligible source erasure removes identifying review custody; permanent anonymous event facts remain.' }
}
export const retentionHistoryErasureCount = (dataset: string) => ({ store: 'bf_retention_acknowledgments', query: sql('SELECT count(*) FROM bf_retention_acknowledgments WHERE dataset_id=?', dataset) })
export const eraseRetentionHistory = (dataset: string) => sql('DELETE FROM bf_retention_acknowledgments WHERE dataset_id=?', dataset)
