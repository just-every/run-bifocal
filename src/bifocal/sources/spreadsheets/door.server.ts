import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import { sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { fileImportResponse } from '../../imports/files/server'
import { RangeError, type RangeData, type RangeInput } from './protocol'

/** Range reads become ordinary file-door uploads and plans. The dataset keeps
 * one files: namespace, revision fence, approval, reconcile and Undo history. */
export async function planRange(request: Request, env: Bindings, input: RangeInput, data: RangeData): Promise<Response> {
 const csv = data.rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n'
 if (Buffer.byteLength(csv, 'utf8') > 524288) throw new RangeError('spreadsheet_csv_limit', 413)
 const spreadsheet = { provider: input.provider, workbook: input.workbook, sheet: input.sheet, range: input.range, fetchedAt: new Date().toISOString(), formulas: data.formulas }
 const bytes = Buffer.from(JSON.stringify({ version: 1, datasetId: input.datasetId, filename: 'spreadsheet-range.csv', data: csv, delimiter: ',', encoding: 'utf-8', nullValue: input.nullValue, mode: input.mode, ...(input.key !== undefined ? { key: input.key } : {}), ...(input.mapping ? { columns: input.mapping } : {}), formulaTreatment: 'cached-values-preserve-formulas', spreadsheet }))
 if (bytes.length > 1048576) throw new RangeError('spreadsheet_envelope_limit', 413)
 const call = async (path: string, body: unknown) => {
  // Copy only native session authority. The provider token, arbitrary request
  // headers and all supplied URLs never reach import custody or another host.
  const native = new Request(new URL(`/api/operator/import/${path}`, env.AUTH_ORIGIN), { method: 'POST', headers: { host: new URL(env.AUTH_ORIGIN).host, 'content-type': 'application/json', origin: env.AUTH_ORIGIN, cookie: request.headers.get('cookie') ?? '', 'X-Import-Dataset': input.datasetId }, body: JSON.stringify(body) })
  const response = await fileImportResponse(native, env)
  if (!response) throw new RangeError('spreadsheet_import_unavailable', 503)
  return response
 }
 const uploadId = randomUUID(), bundleSha256 = sha256(bytes), totalChunks = Math.ceil(bytes.length / 65536)
 for (let index = 0; index < totalChunks; index++) {
  const chunk = bytes.subarray(index * 65536, (index + 1) * 65536)
  const response = await call('uploads', { uploadId, name: 'spreadsheet-range.json', bundleSha256, totalBytes: bytes.length, totalChunks, index, chunkSha256: sha256(chunk), base64: chunk.toString('base64') })
  if (!response.ok) return response
  await response.body?.cancel()
 }
 return call('plan', { uploadId, ...(input.catchup ? { catchup: true } : {}) })
}
