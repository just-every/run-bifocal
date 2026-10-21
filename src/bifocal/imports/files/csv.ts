import { Buffer } from 'node:buffer'
import { sha256, canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { Json, ParsedRecord, ImportMapping, TargetRow } from '../../../modules/import-kit/src/types.ts'

export const FILE_LIMITS = { bytes: 524288, rows: 2000, columns: 64, cell: 4096, tableBytes: 786432 } as const
export type Column = { name: string; type: 'text' | 'number' | 'money' | 'date' | 'boolean' }
export type Table = { columns: Column[]; rows: Json[][]; key: string | null; source: { filename: string; sha256: string; delimiter: string; encoding: string; nullValue: string; formulaTreatment: string }; updatedAt: string }
class InvalidFile extends Error {}
function refuse(message: string): never { throw new InvalidFile(message) }
const object = (value: unknown): value is Record<string, Json> => !!value && typeof value === 'object' && !Array.isArray(value)
const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const money = /^-?\$?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\.\d{2}$/
function date(value: string): string | null {
 const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
 if (!match) return null
 const [, mm, dd, yyyy] = match, year = Number(yyyy), month = Number(mm), day = Number(dd)
 if (year < 1000 || year > 9999) return null
 const parsed = new Date(Date.UTC(year, month - 1, day))
 return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? `${yyyy}-${mm}-${dd}` : null
}
/** RFC 4180 quoting; no evaluation, trimming or implicit delimiter detection. */
function csv(text: string, delimiter: string): string[][] {
 if (text.includes('\0')) refuse('CSV_NUL: Remove NUL characters before uploading.')
 const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false, closed = false
 const field = () => { if (cell.length > FILE_LIMITS.cell) refuse('CELL_LIMIT: A cell exceeds 4096 characters.'); row.push(cell); cell = ''; closed = false; if (row.length > FILE_LIMITS.columns) refuse('COLUMN_LIMIT: At most 64 columns are supported.') }
 const record = () => { field(); rows.push(row.splice(0)); if (rows.length > FILE_LIMITS.rows + 1) refuse('ROW_LIMIT: At most 2000 data rows are supported.') }
 for (let i = 0; i < text.length; i++) {
  const ch = text[i]
  if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } } else cell += ch }
  else if (ch === '"') { if (cell || closed) refuse('CSV_QUOTE: A quote must begin a field.'); quoted = true }
  else if (ch === delimiter) field()
  else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; record() }
  else { if (closed) refuse('CSV_QUOTE: Unexpected text after a closing quote.'); cell += ch }
  if (cell.length > FILE_LIMITS.cell) refuse('CELL_LIMIT: A cell exceeds 4096 characters.')
 }
 if (quoted) refuse('CSV_QUOTE: Close the quoted field before uploading.')
 if (cell || row.length || closed) record()
 if (rows.length < 2) refuse('CSV_EMPTY: Supply a header and at least one data row.')
 return rows
}
function infer(values: string[]): Column['type'] {
 if (!values.length) return 'text'
 if (values.every(value => value.startsWith('$') || value.startsWith('-$')) && values.every(value => money.test(value))) return 'money'
 if (values.every(value => number.test(value))) return 'number'
 if (values.every(value => date(value))) return 'date'
 if (values.every(value => ['true', 'false'].includes(value))) return 'boolean'
 return 'text'
}
function typed(value: string, type: Column['type']): Json {
 // Decimals remain exact strings, with their declared type. No IEEE-754 rounding.
 if (type === 'text') return value
 if (type === 'number' && number.test(value)) return value
 if (type === 'money' && money.test(value)) return value.replace(/[$,]/g, '')
 if (type === 'date') { const iso = date(value); if (iso) return iso }
 if (type === 'boolean' && ['true', 'false'].includes(value)) return value === 'true'
 refuse('TYPE_MISMATCH')
}
const columnTypes = new Set(['text', 'number', 'money', 'date', 'boolean'])
export function fileSource(datasetId: string, current: TargetRow | undefined, now: string): { parse: (value: Json, index: number) => ParsedRecord; mapping: ImportMapping } {
 const previous = current?.value as unknown as Table | undefined
 function parse(input: Json): ParsedRecord {
  const invalid = (reason: string): ParsedRecord => ({ kind: 'invalid-file', sourceId: datasetId, payload: { reason } })
  try {
   if (!object(input) || Object.keys(input).some(key => !['version','datasetId','filename','data','delimiter','encoding','nullValue','mode','key','columns','formulaTreatment'].includes(key))
     || input.version !== 1 || input.datasetId !== datasetId) refuse('FILE_SCHEMA: Supply the documented version-1 CSV envelope for this dataset.')
   if (typeof input.filename !== 'string' || !/^[^/\\\x00-\x1f]{1,120}\.csv$/i.test(input.filename)) refuse('FILE_TYPE: Only CSV is supported here; workbooks, macros, templates and archives are refused.')
   if (input.encoding !== 'utf-8' || ![',',';','\t','|'].includes(String(input.delimiter)) || typeof input.nullValue !== 'string' || input.nullValue.length > 32) refuse('INTERPRETATION: Choose UTF-8, a supported delimiter and an explicit null marker.')
   if (input.formulaTreatment !== 'literal-text') refuse('FORMULA_TREATMENT: CSV formulas are inert literal text; execution is never supported.')
   if (!['append','replace','keyed-update'].includes(String(input.mode))) refuse('IMPORT_MODE: Choose append, replace or keyed-update.')
   if (typeof input.data !== 'string' || Buffer.byteLength(input.data, 'utf8') > FILE_LIMITS.bytes) refuse('FILE_LIMIT: The CSV byte limit is 524288; split larger data before uploading.')
   // Invalid Unicode cannot round-trip to original UTF-8 bytes.
   if (Buffer.from(input.data, 'utf8').toString('utf8') !== input.data) refuse('ENCODING: Supply valid UTF-8 text.')
   const records = csv(input.data.replace(/^\uFEFF/, ''), String(input.delimiter)), headers = records.shift()!
   if (headers.some(name => !name || name !== name.trim() || name.length > 128) || new Set(headers).size !== headers.length) refuse('HEADERS: Use unique, nonempty headers, at most 128 characters, without outer whitespace.')
   const widthError = records.findIndex(row => row.length !== headers.length)
   if (widthError !== -1) refuse(`ROW_WIDTH: Row ${widthError + 2} does not match the header column count.`)
   let columns: Column[]
   if (input.columns !== undefined) {
    if (!object(input.columns) || Object.keys(input.columns).length !== headers.length || headers.some(name => !Object.hasOwn(input.columns as object, name) || !columnTypes.has(String((input.columns as Record<string, Json>)[name])))) refuse('COLUMN_MAPPING: Map every header to text, number, money, date or boolean.')
    columns = headers.map(name => ({ name, type: (input.columns as Record<string, Json>)[name] as Column['type'] }))
   } else if (previous) columns = previous.columns
   else columns = headers.map((name, i) => ({ name, type: infer(records.map(row => row[i]).filter(value => value !== input.nullValue)) }))
   if (columns.length !== headers.length || columns.some((column, i) => column.name !== headers[i])) refuse('SCHEMA_CHANGED: Review and explicitly map the changed headers before replacing the dataset.')
   if (previous && input.mode !== 'replace' && canonicalJson(columns as unknown as Json) !== canonicalJson(previous.columns as unknown as Json)) refuse('SCHEMA_CHANGED: Append and keyed-update require the current schema. Use an explicitly mapped replace to change types.')
   const errors: string[] = []
   const rows = records.map((row, rowIndex) => row.map((value, colIndex) => {
    if (value === input.nullValue) return null
    try { return typed(value, columns[colIndex].type) } catch { if (errors.length < 20) errors.push(`row ${rowIndex + 2}, column ${colIndex + 1}: expected ${columns[colIndex].type}`); return null }
   }))
   if (errors.length) refuse(`TYPE_MISMATCH: ${errors.join('; ')}. No rows will publish. Correct the file or explicitly map a replacement schema.`)
   const key = input.key === undefined ? previous?.key ?? null : input.key
   if (key !== null && (typeof key !== 'string' || !headers.includes(key))) refuse('KEY: Choose one existing column, or null.')
   if (previous && input.mode !== 'replace' && key !== previous.key) refuse('KEY_CHANGED: Changing the key requires an explicitly reviewed replace.')
   if (input.mode === 'keyed-update' && !key) refuse('KEY_REQUIRED: Keyed update needs an explicit unique key.')
   const table: Table = { columns, rows, key: key as string | null, source: { filename: input.filename as string, sha256: sha256(input.data as string), delimiter: String(input.delimiter), encoding: 'utf-8', nullValue: input.nullValue as string, formulaTreatment: 'literal-text' }, updatedAt: '' }
   return { kind: 'file-table', sourceId: datasetId, payload: { table: table as unknown as Json, mode: input.mode, contentHash: sha256(canonicalJson(input)) } }
  } catch (error) { if (error instanceof InvalidFile) return invalid(error.message); throw error }
 }
 return { parse, mapping: { version: 'csv-v1', map(record) {
  const payload = record.payload as { table?: unknown; mode?: string; reason?: string }
  if (record.kind !== 'file-table' || !payload.table) return { effects: [], rejection: payload.reason ?? 'FILE_SCHEMA: Unsupported file record.' }
  const table = structuredClone(payload.table) as Table
  table.updatedAt = now
  if (previous && payload.mode !== 'replace') {
   if (payload.mode === 'append') table.rows = [...previous.rows, ...table.rows]
   else {
    const keyIndex = table.columns.findIndex(column => column.name === table.key), updates = new Map<Json, Json[]>()
    for (const row of table.rows) { if (row[keyIndex] === null || updates.has(row[keyIndex])) return { effects: [], rejection: 'DUPLICATE_KEY: Incoming keyed rows must have unique non-null keys.' }; updates.set(row[keyIndex], row) }
    table.rows = previous.rows.map(row => { const updated = updates.get(row[keyIndex]); updates.delete(row[keyIndex]); return updated ?? row }).concat([...updates.values()])
   }
  }
  if (table.key) {
   const index = table.columns.findIndex(column => column.name === table.key), seen = new Set<Json>()
   for (const row of table.rows) { if (row[index] === null || seen.has(row[index])) return { effects: [], rejection: 'DUPLICATE_KEY: The final table must have unique non-null keys.' }; seen.add(row[index]) }
  }
  if (table.rows.length > FILE_LIMITS.rows || Buffer.byteLength(canonicalJson(table as unknown as Json)) > FILE_LIMITS.tableBytes) return { effects: [], rejection: 'TABLE_LIMIT: The complete result exceeds 2000 rows or 786432 UTF-8 bytes. No partial table is published.' }
  return { effects: [{ targetKind: 'file-table', targetId: datasetId, value: table as unknown as Json, ...(current ? { expectedRevision: current.revision } : {}) }] }
 } } }
}
