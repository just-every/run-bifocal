import { randomUUID } from 'node:crypto'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'
import type { Run } from './store.server'
export function grantAudit(actor: Authority, run: Run, action: string, reviewerId = actor.id, grantId: string | null = null) {
 const at = new Date().toISOString()
 return [sql('INSERT INTO bf_report_grant_audit(id,run_id,grant_id,owner_id,actor_id,reviewer_id,artifact_digest,action,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),run.id,grantId,run.owner_id,actor.id,reviewerId,run.artifact_digest,action,at),sql('INSERT INTO bf_report_audit(id,run_id,actor_id,action,version,recorded_at) VALUES(?,?,?,?,?,?)',randomUUID(),run.id,actor.id,action,run.version,at)]
}
