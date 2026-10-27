import type { Bindings } from '../../../auth.server'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import { sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { requireValue } from '../analytics/protocol'
import type { WebInput } from './input'
type Owner=D1Sql & {email:string}
/** Only ids, configuration fingerprint, owner, outcome and time are retained.
 * Cancellation is a flag for this synchronous read, never a replacement queue. */
export async function startRead(env:Bindings,owner:Owner,input:WebInput) {
 const {accessToken,...meaning}=input
 await transact(env.DB,owner,[sql("INSERT INTO bf_web_reads(id,owner,dataset_id,fingerprint,state,started_at) VALUES(?,?,?,?,'reading',?)",input.readId,owner.email,input.datasetId,sha256(canonicalJson(meaning)),Date.now())])
}
export async function checkRead(env:Bindings,owner:Owner,input:WebInput) {
 const active=await env.DB.prepare(`SELECT state,started_at,CASE WHEN (${owner.sql}) THEN 1 ELSE 0 END AS authorized FROM bf_web_reads WHERE id=? AND owner=? AND dataset_id=?`).bind(...owner.params??[],input.readId,owner.email,input.datasetId).first<{state:string;started_at:number;authorized:number}>()
 requireValue(active?.authorized===1,'owner_required',401)
 requireValue(active.state==='reading','web_read_cancelled',409)
 requireValue(Date.now()-active.started_at<30000,'web_read_time_limit',409)
}
export async function finishRead(env:Bindings,owner:Owner,id:string,state:'staged'|'failed'|'cancelled') {
 await transact(env.DB,owner,[sql("UPDATE bf_web_reads SET state=?,finished_at=? WHERE id=? AND owner=? AND state='reading'",state,Date.now(),id,owner.email)])
}
export async function cancelRead(env:Bindings,owner:Owner,id:string,dataset:string) {
 await transact(env.DB,owner,[sql("UPDATE bf_web_reads SET state='cancelled',finished_at=? WHERE id=? AND owner=? AND dataset_id=? AND state='reading'",Date.now(),id,owner.email,dataset)])
}
