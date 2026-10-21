import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../../auth.server'
import { createImportOperatorHandler, readImportDoorHistory } from '../../../modules/import-kit/src/door/operator.ts'
import { loadSnapshot, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { readD1ImportOriginals, retireD1ImportCustody, canonicalJson, sha256 } from '../../../modules/import-kit/src/d1/index.ts'
import type { D1ImportContext, D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import type { DoorRequest, DoorPlanRow } from '../../../modules/import-kit/src/door/types.ts'
import { fileSource } from './csv'
import { fileTargets, FILE_DESTINATION } from './targets'
import { fileOwner } from './owner.server'

const DOOR_KEY = 'bifocal:files:v1', PRINCIPAL = 'role:owner'
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const idPattern = /^[a-z][a-z0-9-]{0,63}$/

/** A CSV reader and native adapter on Base's sole import pipeline. Business
 * grants stay closed; no request can turn source data into access or execution. */
export async function fileImportResponse(request: Request, original: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (path.startsWith('/api/rer/import/')) return json({ error: 'not_found' }, 404)
 if (!path.startsWith('/api/operator/import/') && !path.startsWith('/api/operator/datasets/')) return null
 const env = runtimeBindings(original), owner = await fileOwner(request, env)
 if (!owner) return json({ error: 'owner_required', reason: 'Sign in as the current installation owner and use the same app origin.' }, 401)
 const dataset = path.startsWith('/api/operator/datasets/') ? path.split('/')[4] : request.headers.get('X-Import-Dataset') ?? ''
 if (!idPattern.test(dataset)) return json({ error: 'dataset_required', reason: 'Use a stable dataset id: a letter followed by lowercase letters, digits or hyphens, at most 64 characters.' }, 400)
 const namespace = `files:${dataset}`
 const context = (name: string, mappingVersion = 'csv-v1'): D1ImportContext => ({ destination: FILE_DESTINATION, namespace: name, mappingVersion, storage: { database: env.DB, targets: fileTargets }, authorization: { principalId: PRINCIPAL, predicate: () => owner } })
 const current = await fileTargets.read(env.DB, FILE_DESTINATION, 'file-table', dataset)
 const source = fileSource(dataset, current, new Date().toISOString())
 const options = { ...source, database: env.DB, targets: fileTargets, destination: FILE_DESTINATION, ownerPrincipalId: PRINCIPAL,
  installationId: DOOR_KEY, appOrigin: env.AUTH_ORIGIN, ownerEmail: env.OWNER_EMAIL, namespace, format: 'json' as const,
  limits: { maxBytes: 1048576, maxRecords: 1, maxRecordBytes: 1048576 }, authorize: (incoming: Request) => fileOwner(incoming, env) }
 const rowForPlan = (id: string) => env.DB.prepare('SELECT * FROM ik_door_plans WHERE id=? AND installation_id=? AND namespace=? AND complete=1').bind(id, DOOR_KEY, namespace).first<DoorPlanRow>()
 const admitted: DoorRequest = { options, authority: owner, via: 'operator', epoch: 0, access: { action: 'plan', installationId: DOOR_KEY, email: env.OWNER_EMAIL, namespace, maxBytes: 1048576, maxRecords: 1, maxChunks: 16 } }
 try {
  if (path === `/api/operator/datasets/${dataset}`) {
   if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
   // Admission alone is insufficient: fence the exact returned bytes and session.
   await transact(env.DB, owner, [sql(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${fileTargets.matches(current ?? null, FILE_DESTINATION, 'file-table', dataset).sql}) THEN 1 ELSE 0 END`, ...fileTargets.matches(current ?? null, FILE_DESTINATION, 'file-table', dataset).params ?? [])])
   return current ? json({ dataset, revision: current.revision, table: current.value }) : json({ error: 'dataset_not_found' }, 404)
  }
  if (path === `/api/operator/datasets/${dataset}/erase`) {
   if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
   const raw = await boundedBody(request)
   if (!raw || Object.keys(raw).some(key => !['confirmDataset','reviewedRevision'].includes(key)) || raw.confirmDataset !== dataset || !current || raw.reviewedRevision !== current.revision) return json({ error: 'exact_erasure_confirmation_required', reason: 'Review the current dataset revision and explicitly confirm its id before erasing.' }, 409)
   const state = await env.DB.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first<{ source_identity: string }>()
   const identity = state?.source_identity ?? randomUUID()
   const tombstone = sha256(canonicalJson([identity, 'rer_portability_state', { id: 1 }]))
   const checkpoint = [sql('INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)', identity),
    sql('INSERT INTO rer_portability_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM rer_portability_state WHERE id=1 AND source_identity=?) THEN 1 ELSE 0 END', identity),
    sql('DELETE FROM rer_portability_guard'), sql('INSERT OR IGNORE INTO rer_portability_journal(source,tombstone) VALUES(?,?)', identity, tombstone),
    sql('UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1'),
    sql('INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)')]
   const match = fileTargets.matches(current, FILE_DESTINATION, 'file-table', dataset)
   const receipt = await retireD1ImportCustody({ target: { kind: 'file-table', id: dataset } }, [
    sql(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${match.sql}) THEN 1 ELSE 0 END`, ...match.params ?? []), ...fileTargets.remove(FILE_DESTINATION, 'file-table', dataset), sql('DELETE FROM ik_d1_assertions'),
   ], context(namespace), checkpoint)
   return json({ phase: receipt.phase, receiptId: receipt.receiptId, stores: receipt.stores, reason: 'The dataset and retained import content were erased; unrelated native datasets remain. Historical approval metadata remains. Earlier installation archives require the current erasure journal.' })
  }
  if (path === '/api/operator/import/history') {
   if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
   const history = await readImportDoorHistory(env.DB, DOOR_KEY, owner)
   return json({ history: history.filter(entry => entry.namespace === namespace), businessImports: 'disabled' })
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
  const response = await createImportOperatorHandler(options)(request)
  if (path === '/api/operator/import/plan' && response?.ok) {
   const preview = await response.json() as { planId: string }
   const row = await rowForPlan(preview.planId)
   if (!row) return json({ error: 'plan_not_found' }, 404)
   const snapshot = await loadSnapshot(admitted, row)
   const table = snapshot.plan.entries[0]?.effects[0]?.value as Record<string, unknown> | undefined
   await transact(env.DB, owner, [])
   return json({ ...preview, preview: table ? { columns: table.columns, rowCount: (table.rows as unknown[]).length, sample: (table.rows as unknown[]).slice(0, 5), key: table.key, source: table.source } : null })
  }
  return response
 } catch {
  // No submitted data, internal database details or credentials enter diagnostics.
  return json({ error: 'file_import_conflict', reason: 'The current session, dataset or retained import changed, or custody could not be verified. Sign in again and review a fresh plan; the last committed dataset remains available.' }, 409)
 }
}
async function boundedBody(request: Request): Promise<Record<string, unknown> | null> {
 if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) return null
 const reader = request.body.getReader(); let text = '', size = 0
 const decoder = new TextDecoder('utf-8', { fatal: true })
 try {
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2048) return null; text += decoder.decode(value, { stream: true }) }
  text += decoder.decode(); const body = JSON.parse(text)
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
 } finally { await reader.cancel(); reader.releaseLock() }
}
