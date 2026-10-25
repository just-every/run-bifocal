import { Buffer } from 'node:buffer'
import { sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { Json } from '../../../modules/import-kit/src/types.ts'
import { FILE_LIMITS, originalBase64Limit } from './limits'

export const encodings = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'] as const
/** The original encoded bytes and the reviewed decoded text must agree. */
export function csvOriginal(input: Record<string, Json>) {
 const encoding = String(input.encoding)
 if (!encodings.some(value => value === encoding)) throw Error('ENCODING: Choose UTF-8, UTF-16LE, UTF-16BE or Windows-1252.')
 if (typeof input.data !== 'string') throw Error('FILE_SCHEMA: Supply decoded CSV text.')
 if (input.originalBase64 === undefined) {
  if (encoding !== 'utf-8' || Buffer.from(input.data, 'utf8').toString('utf8') !== input.data) throw Error('ENCODING: Non-UTF-8 files require their original bytes.')
  return { sha256: sha256(input.data), encoding }
 }
 if (typeof input.originalBase64 !== 'string' || input.originalBase64.length > originalBase64Limit(FILE_LIMITS.bytes)) throw Error(`FILE_LIMIT: Original CSV bytes exceed ${FILE_LIMITS.bytes} bytes.`)
 const bytes = Buffer.from(input.originalBase64, 'base64')
 if (bytes.toString('base64') !== input.originalBase64 || bytes.length > FILE_LIMITS.bytes) throw Error(`ENCODING: Supply canonical base64 original bytes within ${FILE_LIMITS.bytes} bytes.`)
 let decoded: string
 try { decoded = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw Error('ENCODING: The file is invalid in the selected encoding.') }
 if (decoded !== input.data) throw Error('ENCODING: Original bytes do not match the reviewed decoded text.')
 return { sha256: sha256(bytes), encoding }
}

export function candidateKeys(headers: string[], rows: Json[][]): string[] {
 return headers.filter((_, index) => rows.length > 0 && rows.every(row => row[index] !== null) && new Set(rows.map(row => JSON.stringify(row[index]))).size === rows.length)
}

/** One entry per bad row, with column indices; values are never diagnostics. */
export type RowErrors = { row: number; columns: number[] }[]

export type Spreadsheet = { provider: 'google' | 'microsoft'; workbook: string; sheet: string; range: string; fetchedAt: string; formulas: {cell: string; formula: string; cached: string}[] }
export function spreadsheetMetadata(value: Json | undefined): Spreadsheet | undefined {
 if (value === undefined) return undefined
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('SPREADSHEET_METADATA: Invalid source lineage.')
 const input = value as Record<string, Json>
 if (Object.keys(input).some(key => !['provider','workbook','sheet','range','fetchedAt','formulas'].includes(key)) || !['google','microsoft'].includes(String(input.provider))
  || !['workbook','sheet','range'].every(key => typeof input[key] === 'string' && (input[key] as string).length > 0 && (input[key] as string).length <= 256)
  || typeof input.fetchedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(input.fetchedAt) || Number.isNaN(Date.parse(input.fetchedAt))
  || !Array.isArray(input.formulas) || input.formulas.length > 2000
  || input.formulas.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'cached,cell,formula' || !['cell','formula','cached'].every(key => typeof (item as Record<string, Json>)[key] === 'string' && ((item as Record<string, Json>)[key] as string).length <= 4096))) throw Error('SPREADSHEET_METADATA: Invalid or over-limit source lineage.')
 return input as unknown as Spreadsheet
}
