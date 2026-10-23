import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import { sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
export function readAudit(env: Bindings, owner: D1Sql & {email:string}, dataset: string, meaning: unknown) {
 const id = randomUUID(), fingerprint = sha256(canonicalJson(meaning))
 return (event:'consented'|'staged'|'failed'|'refused') => transact(env.DB, owner, [sql('INSERT INTO bf_analytics_reads(id,event,owner,dataset_id,fingerprint,recorded_at) VALUES(?,?,?,?,?,?)',id,event,owner.email,dataset,fingerprint,new Date().toISOString())])
}
