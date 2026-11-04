import { Buffer } from 'node:buffer'
import { fail } from '../../../query/types'
import { record, codeValue } from './reader'

function inspect(value: unknown, depth = 0): void {
 if (depth > 48) fail('migration_content_depth', 400)
 if (typeof value === 'string') {
  if (/Bearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]+/i.test(value) || /https?:\/\/[^\s"']*(?:[?&](?:token|key|secret|signature)=|[^/\s]+:[^/@\s]+@)/i.test(value)) fail('migration_secret_excluded', 422)
  return
 }
 if (Array.isArray(value)) { value.forEach(v => inspect(v, depth + 1)); return }
 if (record(value)) for (const [key, item] of Object.entries(value)) {
  if (/(?:password|secret|token|api[-_]?key|authorization|credential|private[-_]?key)/i.test(key) && item !== null && item !== '') fail('migration_secret_excluded', 422)
  inspect(item, depth + 1)
 }
}
/** Refuse credential-bearing migration documents before shared-door custody. */
export async function guardMigrationUpload(request: Request) {
 const input = await request.clone().json() as Record<string, unknown>
 if (typeof input.base64 !== 'string') return
 if (input.totalChunks !== 1 || input.index !== 0) fail('sigma_complete_envelope_required', 413)
 const bytes = Buffer.from(input.base64, 'base64')
 let value: unknown
 try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail('migration_json_required', 400) }
 inspect(value)
 if (!record(value) || !record(value.sigma) || typeof value.sigma.content !== 'string') fail('sigma_original_file_required', 400)
 inspect(codeValue(value.sigma.content))
}
