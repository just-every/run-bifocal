import { webMetadata, type WebMetadata } from '../../sources/web/metadata'
import { lineage, type Lineage } from '../../sources/analytics/lineage'
import { Buffer } from 'node:buffer'
import { csvOriginal, candidateKeys, spreadsheetMetadata, type Spreadsheet, type RowErrors } from './interpretation'
import { readWorkbook, WorkbookError } from './xlsx'
import { sha256, canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { Json, ParsedRecord, ImportMapping, TargetRow } from '../../../modules/import-kit/src/types.ts'
import { FILE_LIMITS } from './limits'

export { FILE_LIMITS } from './limits'
export type Column = { name: string; type: 'text' | 'number' | 'money' | 'date' | 'boolean' }
export type Table = { columns: Column[]; rows: Json[][]; key: string | null; keyCandidates?: string[]; source: { filename: string; sha256: string; delimiter: string; encoding: string; nullValue: string; formulaTreatment: string; lineage?: Lineage; webSource?: WebMetadata; spreadsheet?: Spreadsheet; sheet?: string; sheets?: string[]; formulas?: { cell: string; formula: string; cached: string }[] }; updatedAt: string }
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
function csv(text: string, delimiter: string, allowEmpty = false): string[][] {
 if (text.includes('\0')) refuse('CSV_NUL: Remove NUL characters before uploading.')
 const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false, closed = false
 const field = () => { if (cell.length > FILE_LIMITS.cell) refuse(`CELL_LIMIT: A cell exceeds ${FILE_LIMITS.cell} characters.`); row.push(cell); cell = ''; closed = false; if (row.length > FILE_LIMITS.columns) refuse(`COLUMN_LIMIT: At most ${FILE_LIMITS.columns} columns are supported.`) }
 const record = () => { field(); rows.push(row.splice(0)); if (rows.length > FILE_LIMITS.rows + 1) refuse(`ROW_LIMIT: At most ${FILE_LIMITS.rows} data rows are supported.`) }
 for (let i = 0; i < text.length; i++) {
  const ch = text[i]
  if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } } else cell += ch }
  else if (ch === '"') { if (cell || closed) refuse('CSV_QUOTE: A quote must begin a field.'); quoted = true }
  else if (ch === delimiter) field()
  else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; record() }
  else { if (closed) refuse('CSV_QUOTE: Unexpected text after a closing quote.'); cell += ch }
  if (cell.length > FILE_LIMITS.cell) refuse(`CELL_LIMIT: A cell exceeds ${FILE_LIMITS.cell} characters.`)
 }
 if (quoted) refuse('CSV_QUOTE: Close the quoted field before uploading.')
 if (cell || row.length || closed) record()
 if (rows.length < (allowEmpty ? 1 : 2)) refuse('CSV_EMPTY: Supply a header and at least one data row.')
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
  let review: Json = null
  const invalid = (reason: string): ParsedRecord => ({ kind: 'invalid-file', sourceId: datasetId, payload: { reason, review } })
  try {
   if (!object(input) || Object.keys(input).some(key => !['version','datasetId','filename','data','delimiter','encoding','nullValue','mode','key','columns','formulaTreatment','sheet','originalBase64','spreadsheet','lineage','webSource'].includes(key))
     || input.version !== 1 || input.datasetId !== datasetId) refuse('FILE_SCHEMA: Supply the documented version-1 file envelope for this dataset.')
   if (typeof input.filename !== 'string' || !/^[^/\\\x00-\x1f]{1,120}\.(csv|xlsx)$/i.test(input.filename)) refuse('FILE_TYPE: Choose CSV or XLSX; macro-enabled workbooks, templates and archives are refused.')
   if (![',',';','\t','|'].includes(String(input.delimiter)) || typeof input.nullValue !== 'string' || input.nullValue.length > 32) refuse('INTERPRETATION: Choose a supported delimiter and an explicit null marker.')
   let sourceLineage: Lineage | undefined
   try { sourceLineage = lineage(input.lineage) } catch { refuse('SOURCE_LINEAGE: Supply a credential-free source link, explicit date window, timezone and description.') }
   let webSource: WebMetadata | undefined
   try { webSource = webMetadata(input.webSource) } catch { refuse('WEB_METADATA: Supply complete snapshot metadata.') }
   if (webSource && (input.mode !== 'replace' || input.columns === undefined)) refuse('WEB_SNAPSHOT: A complete web snapshot requires explicit types and reviewed replacement.')
   const isWorkbook = String(input.filename).toLowerCase().endsWith('.xlsx')
   let spreadsheet: Spreadsheet | undefined
   try { spreadsheet = spreadsheetMetadata(input.spreadsheet) } catch (error) { refuse((error as Error).message) }
   if (isWorkbook && webSource) refuse('WEB_SNAPSHOT: Web snapshots use normalized CSV only.')
   if (isWorkbook && spreadsheet) refuse('SPREADSHEET_METADATA: Range metadata applies to CSV cached range values only.')
   if (input.formulaTreatment !== (isWorkbook || spreadsheet ? 'cached-values-preserve-formulas' : 'literal-text')) refuse('FORMULA_TREATMENT: Explicitly choose literal-text for CSV or cached-values-preserve-formulas for XLSX; nothing is evaluated.')
   if (!['append','replace','keyed-update'].includes(String(input.mode))) refuse('IMPORT_MODE: Choose append, replace or keyed-update.')
   if (typeof input.data !== 'string' || (!isWorkbook && Buffer.byteLength(input.data, 'utf8') > FILE_LIMITS.bytes)) refuse(`FILE_LIMIT: Decoded CSV text must fit ${FILE_LIMITS.bytes} UTF-8 bytes; split larger data before uploading.`)
   let original: {sha256: string; encoding: string} | null = null
   if (!isWorkbook) { try { original = csvOriginal(input) } catch (error) { refuse((error as Error).message) } }
   else if (input.encoding !== 'utf-8' || input.originalBase64 !== undefined) refuse('ENCODING: XLSX uses UTF-8 XML and its data holds original bytes.')
   const workbook = isWorkbook ? readWorkbook(input.data, input.sheet) : null
   if (!isWorkbook && input.sheet !== undefined) refuse('CSV_SHEET: Sheet selection applies only to XLSX workbooks.')
   const records = workbook ? workbook.rows : csv(input.data.replace(/^\uFEFF/, ''), String(input.delimiter), !!webSource), headers = records.shift()!
   if (headers.length > FILE_LIMITS.columns || records.length > FILE_LIMITS.rows) refuse(`TABLE_LIMIT: At most ${FILE_LIMITS.columns} columns and ${FILE_LIMITS.rows} data rows are supported.`)
   if (headers.some(name => !name || name !== name.trim() || name.length > 128) || new Set(headers).size !== headers.length) refuse('HEADERS: Use unique, nonempty headers, at most 128 characters, without outer whitespace.')
   const widthErrors = records.flatMap((row, index) => row.length === headers.length ? [] : [{row: index + 2, actual: row.length, expected: headers.length}])
   let columns: Column[]
   if (input.columns !== undefined) {
    if (!object(input.columns) || Object.keys(input.columns).length !== headers.length || headers.some(name => !Object.hasOwn(input.columns as object, name) || !columnTypes.has(String((input.columns as Record<string, Json>)[name])))) refuse('COLUMN_MAPPING: Map every header to text, number, money, date or boolean.')
    columns = headers.map(name => ({ name, type: (input.columns as Record<string, Json>)[name] as Column['type'] }))
   } else if (previous) {
    if (workbook && workbook.types.some((type, i) => type && type !== previous.columns[i]?.type)) refuse('SCHEMA_TYPE_CHANGED: Workbook cell types changed. Explicitly review and map a replacement schema; no automatic text/number coercion is allowed.')
    columns = previous.columns
   } else if (workbook) {
    if (workbook.types.includes('mixed')) refuse('COLUMN_MAPPING: Mixed workbook cell types require an explicit column mapping.')
    columns = headers.map((name, i) => ({ name, type: workbook.types[i] === 'mixed' ? 'text' : workbook.types[i] ?? 'text' }))
   } else columns = headers.map((name, i) => ({ name, type: infer(records.map(row => row[i] ?? String(input.nullValue)).filter(value => value !== input.nullValue)) }))
   if (columns.length !== headers.length || columns.some((column, i) => column.name !== headers[i])) refuse('SCHEMA_CHANGED: Review and explicitly map the changed headers before replacing the dataset.')
   if (previous && input.mode !== 'replace' && canonicalJson(columns as unknown as Json) !== canonicalJson(previous.columns as unknown as Json)) refuse('SCHEMA_CHANGED: Append and keyed-update require the current schema. Use an explicitly mapped replace to change types.')
   if (sourceLineage?.kind === 'vane-export' && !['label','visitors','visits','conversions','conversionRate','revenue','currency'].every(name => headers.includes(name))) refuse('VANE_EXPORT_SCHEMA: Use the Vane UTM campaigns report CSV, including conversion counts, rates and currency.')
   const errors: string[] = [], rowErrors: RowErrors = []
   const rows = records.map((row, rowIndex) => columns.map((column, colIndex) => {
    const value = row[colIndex]
    if (value === undefined) return null
    if (value === input.nullValue) return null
    try { return typed(value, columns[colIndex].type) } catch { let bad = rowErrors.at(-1); if (bad?.row !== rowIndex + 2) rowErrors.push(bad = { row: rowIndex + 2, columns: [] }); bad.columns.push(colIndex + 1); if (errors.length < 20) errors.push(`row ${rowIndex + 2}, column ${colIndex + 1}: expected ${columns[colIndex].type}`); return null }
   }))
   review = { columns, rowCount: records.length, rowErrors, widthErrors, errorCount: widthErrors.length + rowErrors.reduce((count, row) => count + row.columns.length, 0) } as unknown as Json
   if (widthErrors.length) refuse(`ROW_WIDTH: ${widthErrors.length} rows do not match the header column count. Inspect the complete retained error inventory; no rows will publish.`)
   if (errors.length) refuse(`TYPE_MISMATCH: ${errors.join('; ')}. No rows will publish. Correct the file or explicitly map a replacement schema.`)
   const key = input.key === undefined ? previous?.key ?? null : input.key
   if (key !== null && (typeof key !== 'string' || !headers.includes(key))) refuse('KEY: Choose one existing column, or null.')
   if (previous && input.mode !== 'replace' && key !== previous.key) refuse('KEY_CHANGED: Changing the key requires an explicitly reviewed replace.')
   if (input.mode === 'keyed-update' && !key) refuse('KEY_REQUIRED: Keyed update needs an explicit unique key.')
   const table: Table = { columns, rows, key: key as string | null, source: { filename: input.filename as string, sha256: workbook?.sha256 ?? original!.sha256, delimiter: workbook ? 'not-applicable' : String(input.delimiter), encoding: workbook ? 'XLSX UTF-8 XML' : original!.encoding, nullValue: input.nullValue as string, formulaTreatment: String(input.formulaTreatment), ...(sourceLineage ? {lineage:sourceLineage} : {}), ...(webSource ? {webSource} : {}), ...(spreadsheet ? { spreadsheet, formulas: spreadsheet.formulas } : {}), ...(workbook ? { sheet: workbook.sheet, sheets: workbook.sheets, formulas: workbook.formulas } : {}) }, updatedAt: '' }
   return { kind: 'file-table', sourceId: datasetId, payload: { table: table as unknown as Json, mode: input.mode, contentHash: sha256(canonicalJson(input)) } }
  } catch (error) { if (error instanceof InvalidFile || error instanceof WorkbookError) return invalid(error.message); throw error }
 }
 return { parse, mapping: { version: 'files-v1', map(record) {
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
  if (table.rows.length > FILE_LIMITS.rows) return { effects: [], rejection: `TABLE_LIMIT: The complete result exceeds ${FILE_LIMITS.rows} rows. No partial table is published.` }
  table.keyCandidates = candidateKeys(table.columns.map(column => column.name), table.rows)
  if (Buffer.byteLength(canonicalJson(table as unknown as Json)) > FILE_LIMITS.tableBytes) return { effects: [], rejection: `TABLE_LIMIT: The complete result exceeds ${FILE_LIMITS.tableBytes} UTF-8 bytes. No partial table is published.` }
  return { effects: [{ targetKind: 'file-table', targetId: datasetId, value: table as unknown as Json, ...(current ? { expectedRevision: current.revision } : {}) }] }
 } } }
}
