import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { RangeInput } from './protocol'
type Owner = D1Sql & { email: string }
/** Persist explicit consent before egress; the fingerprint excludes the grant.
 * Only minimal approval metadata remains, even after source erasure. */
export function readConsent(env: Bindings, owner: Owner, input: RangeInput) {
 const {accessToken, ...meaning} = input, id = randomUUID(), fingerprint = sha256(canonicalJson(meaning))
 return (event: 'consented'|'staged'|'refused'|'failed') => transact(env.DB, owner, [sql(
  'INSERT INTO bf_spreadsheet_reads(id,event,owner,dataset_id,provider,request_fingerprint,recorded_at) VALUES(?,?,?,?,?,?,?)',
  id,event,owner.email,input.datasetId,input.provider,fingerprint,new Date().toISOString())])
}
export async function consentHistory(env: Bindings, owner: Owner) {
 const results = await env.DB.batch([assertion(owner),sql('SELECT id,event,owner,dataset_id AS dataset,provider,request_fingerprint AS fingerprint,recorded_at AS recordedAt FROM bf_spreadsheet_reads ORDER BY recorded_at DESC LIMIT 101'),assertion(owner),sql('DELETE FROM ik_d1_assertions')].map(q=>env.DB.prepare(q.sql).bind(...q.params ?? [])))
 const rows = results[1].results
 return {events:rows.slice(0,100),more:rows.length>100}
}
