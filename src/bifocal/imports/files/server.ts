import { alertErasure, alertErasureCounts } from '../../alerts/erasure'
import { preparationResponse } from '../../preparation/server'
import { migrationImportResponse } from '../migrations/door.server'
import {collaborationErasureCounts} from '../../collaboration/erasure'
import { retentionAllowsErasure } from '../../retention/policy.server'
import {definitionErasureCounts,eraseDefinitions} from '../../environments/erasure'
import { eraseSourceCalculationLibraries } from '../../calculations/library/store.server'
import { modelImportResponse } from '../models/door.server'
import { eraseSourceModelProjects } from '../models/store.server'
import { goalErasure, goalErasureCounts } from '../../goals/erasure'
import { reportErasureCounts } from '../../reports/store.server'
import { catalogErasure, catalogErasureCounts } from '../../catalog/erasure'
import { semanticErasure, semanticErasureCounts } from '../../models/validation/erasure'
import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../../auth.server'
import { createImportOperatorHandler, readImportDoorHistory } from '../../../modules/import-kit/src/door/operator.ts'
import { loadSnapshot, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { readD1ImportOriginals, retireD1ImportCustody, canonicalJson, sha256 } from '../../../modules/import-kit/src/d1/index.ts'
import type { D1ImportContext } from '../../../modules/import-kit/src/d1/types.ts'
import type { DoorRequest, DoorPlanRow } from '../../../modules/import-kit/src/door/types.ts'
import { DoorError } from '../../../modules/import-kit/src/door/protocol.ts'
import { fileSource } from './csv'
import { fileTargets, fileDestination } from './targets'
import { fileOwner } from './owner.server'
import { retainReview, readReview } from './reviews.server'
import { FILE_LIMITS } from './limits'

const DOOR_KEY = 'bifocal:files:v1', PRINCIPAL = 'role:owner'
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const idPattern = /^[a-z][a-z0-9-]{0,63}$/

/** A CSV reader and native adapter on Base's sole import pipeline. Business
 * grants stay closed; no request can turn source data into access or execution. */
export async function fileImportResponse(request: Request, original: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 const preparation=await preparationResponse(request,original)
 if(preparation)return preparation
 const migrationImport=await migrationImportResponse(request,original)
 if(migrationImport)return migrationImport
 const modelImport=await modelImportResponse(request,original)
 if(modelImport)return modelImport
 if (path.startsWith('/api/rer/import/')) return refuseRequest(request, { error: 'not_found' }, 404)
 if (!path.startsWith('/api/operator/import/') && !path.startsWith('/api/operator/datasets/')) return null
 const env = runtimeBindings(original), owner = await fileOwner(request, env)
 if (!owner) return refuseRequest(request, { error: 'owner_required', reason: 'Sign in as the current installation owner and use the same app origin.' }, 401)
 const dataset = path.startsWith('/api/operator/datasets/') ? path.split('/')[4] : request.headers.get('X-Import-Dataset') ?? ''
 if (!idPattern.test(dataset)) return refuseRequest(request, { error: 'dataset_required', reason: 'Use a stable dataset id: a letter followed by lowercase letters, digits or hyphens, at most 64 characters.' }, 400)
 const namespace = `files:${dataset}`, destination = fileDestination(dataset)
 const context = (name: string, mappingVersion = 'files-v1'): D1ImportContext => ({ destination, namespace: name, mappingVersion, storage: { database: env.DB, targets: fileTargets }, authorization: { principalId: PRINCIPAL, predicate: () => owner } })
 const current = await fileTargets.read(env.DB, destination, 'file-table', dataset)
 const source = fileSource(dataset, current, new Date().toISOString())
 const options = { ...source, database: env.DB, targets: fileTargets, destination, ownerPrincipalId: PRINCIPAL,
  installationId: DOOR_KEY, appOrigin: env.AUTH_ORIGIN, ownerEmail: owner.email, namespace, format: 'json' as const,
  limits: { maxBytes: FILE_LIMITS.envelopeBytes, maxRecords: 1, maxRecordBytes: FILE_LIMITS.envelopeBytes }, authorize: (incoming: Request) => fileOwner(incoming, env) }
 const rowForPlan = (id: string) => env.DB.prepare('SELECT * FROM ik_door_plans WHERE id=? AND installation_id=? AND namespace=? AND complete=1').bind(id, DOOR_KEY, namespace).first<DoorPlanRow>()
 const admitted: DoorRequest = { options, authority: owner, via: 'operator', epoch: 0, access: { action: 'plan', installationId: DOOR_KEY, email: owner.email, namespace, maxBytes: FILE_LIMITS.envelopeBytes, maxRecords: 1, maxChunks: Math.ceil(FILE_LIMITS.envelopeBytes/FILE_LIMITS.chunkBytes) } }
 try {
  if (path === `/api/operator/datasets/${dataset}`) {
   if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
   // Admission alone is insufficient: fence the exact returned bytes and session.
   await transact(env.DB, owner, [sql(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${fileTargets.matches(current ?? null, destination, 'file-table', dataset).sql}) THEN 1 ELSE 0 END`, ...fileTargets.matches(current ?? null, destination, 'file-table', dataset).params ?? [])])
   return current ? json({ dataset, revision: current.revision, table: current.value }) : json({ error: 'dataset_not_found' }, 404)
  }
  if (path === `/api/operator/datasets/${dataset}/erase`) {
   if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
   const raw = await boundedBody(request)
   if (!raw || Object.keys(raw).some(key => !['confirmDataset','reviewedRevision'].includes(key)) || raw.confirmDataset !== dataset || raw.reviewedRevision !== (current?.revision ?? null)) return json({ error: 'exact_erasure_confirmation_required', reason: 'Review the dataset state and explicitly confirm its id and current revision, or null when no table is published, before erasing.' }, 409)
   const retention=retentionAllowsErasure(dataset)
   const allowed=await env.DB.prepare(`SELECT CASE WHEN (${retention.sql}) THEN 1 ELSE 0 END AS allowed`).bind(...retention.params??[]).first<{allowed:number}>()
   if(!allowed?.allowed)return json({error:'retention_hold',reason:'This source is protected by a legal hold or minimum retention date. Review the retention policy; no erasure was started.'},423)
   const sourceMatch = fileTargets.matches(current ?? null, destination, 'file-table', dataset)
   const match=sql(`(${sourceMatch.sql}) AND (${retention.sql})`,...sourceMatch.params??[],...retention.params??[])
   const derived = 'SELECT snapshot_id FROM bf_query_sources WHERE dataset_id=?'
   const inputCounts=[{store:'bf_input_tables',query:sql('SELECT count(*) FROM bf_input_tables WHERE dataset_id=?',dataset)},...['bf_input_rows','bf_input_history','bf_input_schemas'].map(store=>({store,query:sql(`SELECT count(*) FROM ${store} WHERE table_id IN (SELECT id FROM bf_input_tables WHERE dataset_id=?)`,dataset)}))]
   const extraCounts=[...alertErasureCounts(dataset),...inputCounts,...['bf_preparations','bf_preparation_revisions','bf_preparation_sources'].map(store=>({store,query:sql(`SELECT count(*) FROM ${store} WHERE ${store==='bf_preparations'?'id':'preparation_id'} IN (SELECT preparation_id FROM bf_preparation_sources WHERE dataset_id=?)`,dataset)})),...collaborationErasureCounts(dataset),...definitionErasureCounts(dataset),...semanticErasureCounts(dataset),...catalogErasureCounts(dataset),...reportErasureCounts(dataset),{store:'bf_metrics',query:sql('SELECT count(*) FROM bf_metrics WHERE id IN (SELECT metric_id FROM bf_metric_revisions WHERE dataset_id=?)',dataset)},...goalErasureCounts(dataset),{store:'bf_quality_rules',query:sql('SELECT count(*) FROM bf_quality_rules WHERE dataset_id=?',dataset)}]
   const counts = sql(`SELECT json_extract(value,'$.store') AS store,json_extract(value,'$.rows') AS rows FROM json_each(json_array(
    json_object('store','bf_file_tables','rows',(SELECT count(*) FROM bf_file_tables WHERE id=?)),
    json_object('store','bf_file_reviews','rows',(SELECT count(*) FROM bf_file_reviews WHERE dataset_id=?)),
    json_object('store','bf_query_snapshots','rows',(SELECT count(*) FROM bf_query_snapshots WHERE id IN (${derived}))),
    json_object('store','bf_query_sources','rows',(SELECT count(*) FROM bf_query_sources WHERE snapshot_id IN (${derived}))),
    json_object('store','bf_query_artifacts','rows',(SELECT count(*) FROM bf_query_artifacts WHERE snapshot_id IN (${derived}))),
    json_object('store','bf_analytics_boards','rows',(SELECT count(*) FROM bf_analytics_boards WHERE id IN (SELECT board_id FROM bf_analytics_cards WHERE snapshot_id IN (${derived})))),
    json_object('store','bf_analytics_cards','rows',(SELECT count(*) FROM bf_analytics_cards WHERE board_id IN (SELECT board_id FROM bf_analytics_cards WHERE snapshot_id IN (${derived})))),${extraCounts.map(entry=>`json_object('store','${entry.store}','rows',(${entry.query.sql}))`).join(',')}))`, dataset, dataset, dataset, dataset, dataset, dataset, dataset,...extraCounts.flatMap(entry=>entry.query.params??[]))
   const auditId=randomUUID()
   const auditStatements=[sql("INSERT INTO bf_erasure_audit(id,actor_ref,subject_ref,recorded_at,kind) VALUES(?,?,?,?,'source_erasure')",auditId,randomUUID(),randomUUID(),new Date().toISOString()),sql('INSERT INTO bf_erasure_pending(destination,audit_id) VALUES(?,?)',destination,auditId),sql(`INSERT INTO bf_erasure_stores(audit_id,store,rows) SELECT ?,store,rows FROM (${counts.sql})`,auditId,...counts.params??[])]
   const calculationLibraries=await eraseSourceCalculationLibraries(env,owner,dataset,match)
   const modelProjects=await eraseSourceModelProjects(env,owner,dataset,match)
   // Derivative erasure can initialize the journal. Bind the source checkpoint
   // to that same installation identity after those guarded retirements.
   const state = await env.DB.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first<{ source_identity: string }>()
   const identity = state?.source_identity ?? randomUUID()
   const tombstone = sha256(canonicalJson([identity, 'rer_portability_state', { id: 1 }]))
   const checkpoint = [sql('INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)', identity),
    sql('INSERT INTO rer_portability_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM rer_portability_state WHERE id=1 AND source_identity=?) THEN 1 ELSE 0 END', identity),
    sql('DELETE FROM rer_portability_guard'), sql('INSERT OR IGNORE INTO rer_portability_journal(source,tombstone) VALUES(?,?)', identity, tombstone),
    sql('UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1'),
    sql('INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)')]
   const receipt = await retireD1ImportCustody({ target: { kind: 'file-table', id: dataset } }, [
    sql(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${match.sql}) THEN 1 ELSE 0 END`, ...match.params ?? []), counts, ...auditStatements, ...alertErasure(dataset), ...eraseDefinitions(dataset), semanticErasure(dataset),catalogErasure(dataset),sql('DELETE FROM bf_questions WHERE id IN (SELECT question_id FROM bf_question_sources WHERE dataset_id=?)',dataset),sql(`DELETE FROM bf_query_snapshots WHERE id IN (${derived})`, dataset),
    sql('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bf_query_sources WHERE dataset_id=?) THEN 1 ELSE 0 END', dataset), ...fileTargets.remove(destination, 'file-table', dataset), sql('DELETE FROM bf_file_reviews WHERE dataset_id=?', dataset),sql('DELETE FROM bf_source_retention WHERE dataset_id=?',dataset), sql('DELETE FROM bf_metrics WHERE id IN (SELECT metric_id FROM bf_metric_revisions WHERE dataset_id=?)',dataset), sql('DELETE FROM bf_quality_rules WHERE dataset_id=?',dataset), goalErasure(dataset), sql('DELETE FROM ik_d1_assertions'),
   ], context(namespace), checkpoint)
   const nativeStores = (receipt.nativeResults[1] as {results: {store: string; rows: number}[]}).results.filter(store => store.rows > 0)
   return json({ phase: receipt.phase, receiptId: receipt.receiptId, auditId, modelProjects, calculationLibraries, stores: [...receipt.stores, ...nativeStores], reason: 'The dataset and all retained import content in its namespace were erased; unrelated datasets remain. Dependent query snapshots, report results, semantic definitions and controlled catalog metadata/search/usage were withdrawn in the same erasure batch. This dataset id is retired: later plans answer source_erased; use a new id for new data. Plan and read-consent ids, fingerprints, approving owner, times and dataset id remain as history. An earlier archive is refused only where this erasure journal is known; a fresh installation without the journal cannot detect this erasure.' })
  }
  if (path === '/api/operator/import/history') {
   if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
   const history = await readImportDoorHistory(env.DB, DOOR_KEY, owner)
   return json({ history: history.filter(entry => entry.namespace === namespace), businessImports: 'disabled' })
  }
  if (path.startsWith('/api/operator/import/review/')) {
   if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
   const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
   if (!Number.isSafeInteger(offset) || offset < 0) return json({ error: 'invalid_offset' }, 400)
   const review = await readReview(env.DB, owner, dataset, path.slice('/api/operator/import/review/'.length), offset)
   return review ? json(review) : json({ error: 'review_not_found' }, 404)
  }
  if (path.startsWith('/api/operator/import/original/')) {
   if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
   const row = await rowForPlan(path.slice('/api/operator/import/original/'.length))
   if (!row?.job_id) return json({ error: 'original_not_found' }, 404)
   const job = await env.DB.prepare('SELECT namespace,mapping_version FROM ik_jobs WHERE id=?').bind(row.job_id).first<{ namespace: string; mapping_version: string }>()
   if (!job) return json({ error: 'original_not_found' }, 404)
   const originals = await readD1ImportOriginals(row.job_id, context(job.namespace, job.mapping_version))
   return new Response(JSON.stringify({ originals }), { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="import-originals.json"' } })
  }
  if (path === '/api/operator/import/apply' && request.method === 'POST') {
   const body = await boundedBody(request.clone())
   if (typeof body?.planId === 'string') {
    const row = await rowForPlan(body.planId)
    if (row && body.reviewedFingerprint === row.fingerprint) {
     const snapshot = await loadSnapshot(admitted, row)
     if (snapshot.plan.counts.rejected) return json({ error: 'mapping_rejected', reason: 'This dataset has validation errors. Cancel the plan with Undo, correct the file or mapping and review again; no rows were published.' }, 422)
    }
   }
  }
  const response = await createImportOperatorHandler(options)(request)
  if (path === '/api/operator/import/plan' && response?.ok) {
   const preview = await response.json() as { planId: string }
   const row = await rowForPlan(preview.planId)
   if (!row) return json({ error: 'plan_not_found' }, 404)
   const snapshot = await loadSnapshot(admitted, row)
   const table = snapshot.plan.entries[0]?.effects[0]?.value as Record<string, unknown> | undefined
   const validation = await retainReview(env.DB, owner, dataset, row.id, snapshot.plan)
   await transact(env.DB, owner, [])
   return json({ ...preview, validation, preview: table ? { columns: table.columns, rowCount: (table.rows as unknown[]).length, sample: (table.rows as unknown[]).slice(0, 5), key: table.key, keyCandidates: table.keyCandidates, source: table.source, updatedAt: table.updatedAt } : null })
  }
  return response
 } catch (error) {
  if (error instanceof DoorError) return json({ error: error.code, ...(error.details ? { details: error.details } : {}) }, error.status)
  // No submitted data, internal database details or credentials enter diagnostics.
  return json({ error: 'file_import_conflict', reason: 'The current session, dataset or retained import changed, or custody could not be verified. Sign in again and review a fresh plan; the last committed dataset remains available.' }, 409)
 }
}
async function boundedBody(request: Pick<Request, 'headers' | 'body'>): Promise<Record<string, unknown> | null> {
 if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) return null
 const reader = request.body.getReader(); let text = '', size = 0
 const decoder = new TextDecoder('utf-8', { fatal: true })
 try {
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2048) return null; text += decoder.decode(value, { stream: true }) }
  text += decoder.decode(); const body = JSON.parse(text)
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
 } finally { await reader.cancel(); reader.releaseLock() }
}

/** Finish small denied request bodies before returning. Otherwise a streaming
 * Worker service can abort its upstream connection while a body is in flight.
 * Discard only: no parsing, storage, logging or unbounded drain before refusal. */
async function refuseRequest(request: Request, body: unknown, status: number): Promise<Response> {
 if (request.body) {
  const reader = request.body.getReader(); let bytes = 0
  try {
   for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > 100000) { await reader.cancel(); return json({ error: 'request_too_large' }, 413) }
   }
  } catch { return json({ error: 'invalid_request_stream' }, 400) }
  finally { reader.releaseLock() }
 }
 return json(body, status)
}
