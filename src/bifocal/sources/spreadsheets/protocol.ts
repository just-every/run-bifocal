import type { Column } from '../../imports/files/csv'

export class RangeError extends Error {
 constructor(readonly code: string, readonly status = 400) { super(code) }
}
export const requireRange: (condition: unknown, code?: string) => asserts condition = (condition, code = 'spreadsheet_provider_malformed') => {
 if (!condition) throw new RangeError(code, code === 'spreadsheet_provider_malformed' ? 502 : 400)
}
export const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export type Coordinates = { provider: 'google' | 'microsoft'; workbook: string; sheet: string; range: string; startRow: number; startColumn: number; rows: number; columns: number }
export type RangeInput = Coordinates & { datasetId: string; mode: 'append' | 'replace' | 'keyed-update'; key?: string | null; mapping?: Record<string, Column['type']>; nullValue: string; catchup: boolean; accessToken: string }
export type Formula = { cell: string; formula: string; cached: string }
export type RangeData = { rows: string[][]; formulas: Formula[] }
export function columnNumber(name: string): number { return [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) }
export function columnName(index: number): string {
 let name = ''
 for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
 return name
}
export const cellName = (c: Coordinates, row: number, col: number) => `${columnName(c.startColumn + col)}${c.startRow + row + 1}`
export function cellText(value: unknown): string {
 requireRange(typeof value === 'string' && value.length <= 4096 && !value.includes('\0'))
 return value
}
export function rangeInput(value: unknown): RangeInput {
 requireRange(object(value), 'spreadsheet_invalid_request')
 const allowed = ['provider','workbook','sheet','range','datasetId','mode','key','columns','nullValue','formulaTreatment','accessToken','confirmRead','catchup']
 requireRange(Object.keys(value).every(key => allowed.includes(key)), 'spreadsheet_invalid_request')
 requireRange(value.provider === 'google' || value.provider === 'microsoft', 'spreadsheet_provider_required')
 requireRange(typeof value.workbook === 'string' && (value.provider === 'google' ? /^[A-Za-z0-9_-]{1,128}$/ : /^[A-Za-z0-9_!~-]{1,256}$/).test(value.workbook), 'spreadsheet_invalid_workbook')
 requireRange(typeof value.sheet === 'string' && value.sheet.length > 0 && value.sheet.length <= (value.provider === 'google' ? 100 : 31) && value.sheet.trim() === value.sheet && !['.','..'].includes(value.sheet) && !/[\x00-\x1f\x7f\[\]:*?\/\\]/.test(value.sheet) && !value.sheet.startsWith("'") && !value.sheet.endsWith("'"), 'spreadsheet_invalid_sheet')
 requireRange(typeof value.range === 'string', 'spreadsheet_invalid_range')
 const match = /^([A-Z]{1,3})([1-9]\d{0,6}):([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value.range)
 requireRange(match, 'spreadsheet_invalid_range')
 const startColumn = columnNumber(match[1]) - 1, endColumn = columnNumber(match[3]) - 1, startRow = Number(match[2]) - 1, endRow = Number(match[4]) - 1
 const rows = endRow - startRow + 1, columns = endColumn - startColumn + 1
 requireRange(startRow <= endRow && startColumn <= endColumn && endRow < 1048576 && endColumn < 16384 && rows >= 2 && rows <= 2001 && columns <= 64, 'spreadsheet_range_limit')
 requireRange(typeof value.datasetId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.datasetId), 'spreadsheet_dataset_required')
 requireRange(value.mode === 'append' || value.mode === 'replace' || value.mode === 'keyed-update', 'spreadsheet_invalid_mode')
 requireRange(value.key === undefined || value.key === null || typeof value.key === 'string' && value.key.length > 0 && value.key.length <= 128, 'spreadsheet_invalid_key')
 requireRange(value.mode !== 'keyed-update' || typeof value.key === 'string', 'spreadsheet_key_required')
 requireRange(typeof value.nullValue === 'string' && value.nullValue.length <= 32 && !value.nullValue.includes('\0'), 'spreadsheet_null_marker_required')
 requireRange(value.formulaTreatment === 'cached-values-preserve-formulas' && value.confirmRead === true, 'spreadsheet_explicit_read_required')
 requireRange(value.catchup === undefined || typeof value.catchup === 'boolean', 'spreadsheet_invalid_request')
 requireRange(typeof value.accessToken === 'string' && /^[A-Za-z0-9._~+\/-]{12,8192}={0,2}$/.test(value.accessToken), 'spreadsheet_fresh_token_required')
 if (value.columns !== undefined) {
  requireRange(object(value.columns) && Object.keys(value.columns).length > 0 && Object.keys(value.columns).length <= 64 && Object.entries(value.columns).every(([name, type]) => name.length > 0 && name.length <= 128 && ['text','number','money','date','boolean'].includes(String(type))), 'spreadsheet_invalid_columns')
 }
 const { accessToken, ...withoutToken } = value
 requireRange(!JSON.stringify(withoutToken).includes(accessToken), 'spreadsheet_credential_in_source')
 return { provider: value.provider, workbook: value.workbook, sheet: value.sheet, range: value.range, startRow, startColumn, rows, columns, datasetId: value.datasetId, mode: value.mode, ...(value.key !== undefined ? { key: value.key as string | null } : {}), ...(value.columns !== undefined ? { mapping: value.columns as Record<string, Column['type']> } : {}), nullValue: value.nullValue, catchup: value.catchup === true, accessToken }
}

/** Bounds decoded UTF-8 bytes, including chunked bodies without Content-Length. */
export async function boundedText(body: ReadableStream<Uint8Array> | null, maxBytes: number, error: string): Promise<string> {
 if (!body) throw new RangeError(error, 400)
 const reader = body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = ''
 try {
  for (;;) {
   const chunk = await reader.read()
   if (chunk.done) break
   bytes += chunk.value.byteLength
   if (bytes > maxBytes) throw new RangeError(error, 413)
   text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
 } finally { try { await reader.cancel() } finally { reader.releaseLock() } }
}
