import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Bindings } from '../auth.server'
import { fileImportResponse } from '../bifocal/imports/files/server'
import { conventionsResponse } from '../bifocal/company/server'
import { catalogResponse } from '../bifocal/catalog/server'
import { exactQueryResponse } from '../bifocal/query/server'

/** Real authenticated transport handlers, without re-entering withDemo's seed lock. */
export function demoDoor(env: Bindings, cookie: string) {
 return async (path: string, body?: unknown, dataset?: string): Promise<any> => {
  const request = new Request(env.AUTH_ORIGIN + path, {
   method: body === undefined ? 'GET' : 'POST',
   headers: { Host: new URL(env.AUTH_ORIGIN).host, Origin: env.AUTH_ORIGIN, Cookie: cookie,
    'Content-Type': 'application/json', ...(dataset ? { 'X-Import-Dataset': dataset } : {}) },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const response = await fileImportResponse(request, env) ?? await conventionsResponse(request, env) ?? await exactQueryResponse(request, env) ?? await catalogResponse(request, env)
  if (response?.status === 404 && body === undefined) return null
  if (!response?.ok) throw new Error(`Demo door refused ${path}: ${response?.status ?? 'unhandled'}`)
  return response.json()
 }
}
export type DemoDoor = ReturnType<typeof demoDoor>
export type DemoDataset = { id: string; filename: string; key: string; columns: Record<string, string>; data: string }
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export async function importDemoDataset(call: DemoDoor, source: DemoDataset) {
 // A completed dataset survives an interrupted seed. Never overwrite visitor edits.
 if (await call('/api/operator/datasets/' + source.id)) return
 const bytes = Buffer.from(JSON.stringify({ version: 1, datasetId: source.id, filename: source.filename,
  encoding: 'utf-8', delimiter: ',', nullValue: '', formulaTreatment: 'literal-text', mode: 'replace',
  key: source.key, columns: source.columns, data: source.data }))
 let uploadId: string | undefined
 const totalChunks = Math.ceil(bytes.length / 65536)
 for (let index = 0; index < totalChunks; index++) {
  const chunk = bytes.subarray(index * 65536, (index + 1) * 65536)
  const upload = await call('/api/operator/import/uploads', { ...(uploadId ? { uploadId } : {}),
   name: source.filename + '.json', bundleSha256: digest(bytes), totalBytes: bytes.length,
   totalChunks, index, chunkSha256: digest(chunk), base64: chunk.toString('base64') }, source.id)
  uploadId = upload.uploadId
 }
 const plan = await call('/api/operator/import/plan', { uploadId }, source.id)
 if (plan.counts.rejected) throw new Error('Demo dataset validation failed')
 let complete = false
 for (let step = 0; step < 20; step++) {
  const applied = await call('/api/operator/import/apply', { planId: plan.planId, reviewedFingerprint: plan.fingerprint }, source.id)
  if (applied.job.state === 'completed') { complete = true; break }
  if (!['queued', 'applying'].includes(applied.job.state)) throw new Error('Demo import failed')
 }
 if (!complete) throw new Error('Demo import did not complete')
 const reconciliation = await call('/api/operator/import/reconcile', { planId: plan.planId }, source.id)
 if (!reconciliation.ok) throw new Error('Demo import did not reconcile')
}
