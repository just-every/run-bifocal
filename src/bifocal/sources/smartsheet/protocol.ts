import type { Column } from '../../imports/files/csv'
import { object, requireValue } from '../analytics/protocol'
export const SMARTSHEET_SPEC = { url: 'https://developers.smartsheet.com/_spec/api/smartsheet/openapi.yaml', sha256: 'd74652828457f46a76f153c2434a8cea670805cca0bf6f1a3bc4e6b927a8cb36', version: 'OpenAPI 3.0.3; API 2.0.0' } as const
export const SMARTSHEET_LIMITS = { rows: 2000, columns: 32, pages: 20, pageSize: 100, bytes: 524288 } as const
export const safeId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
export const providerId = (value: unknown): string => { requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, 'smartsheet_unsafe_identity', 502); return String(value) }
export type Selection = { id: string; name: string; type: Column['type'] }
export type Snapshot = { sheetId: string; version: number; observedAt: string; spec: string; columns: (Selection & { sourceType: string; title: string })[]; rowIds: string[]; formulas: { rowId: string; columnId: string; formula: string; cached: string | null }[] }
export function selection(value: unknown): Selection[] {
 requireValue(Array.isArray(value) && value.length > 0 && value.length <= SMARTSHEET_LIMITS.columns, 'smartsheet_columns_required')
 const ids = new Set(), names = new Set(['smartsheet_row_id'])
 return value.map(item => {
  requireValue(object(item) && Object.keys(item).every(key => ['id','name','type'].includes(key)) && safeId(item.id) && typeof item.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(item.name) && ['text','number','money','date','boolean'].includes(String(item.type)) && !ids.has(item.id) && !names.has(item.name), 'smartsheet_explicit_mapping_required')
  ids.add(item.id); names.add(item.name)
  return { id:item.id, name:item.name, type:item.type as Column['type'] }
 })
}
/** Metadata is inert custody, never a provider grant. The shared file parser
 * validates it again when reading the staged envelope. */
export function snapshotMetadata(value: unknown): Snapshot | undefined {
 if (value === undefined) return undefined
 requireValue(object(value) && Object.keys(value).every(key => ['sheetId','version','observedAt','spec','columns','rowIds','formulas'].includes(key)) && safeId(value.sheetId) && Number.isSafeInteger(value.version) && Number(value.version) >= 0 && typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)) && value.spec === SMARTSHEET_SPEC.sha256, 'smartsheet_invalid_snapshot')
 requireValue(Array.isArray(value.columns), 'smartsheet_invalid_snapshot')
 const selected = selection(value.columns.map(column => { requireValue(object(column), 'smartsheet_invalid_snapshot'); return {id:column.id,name:column.name,type:column.type} }))
 requireValue(value.columns.every(column => object(column) && Object.keys(column).every(key => ['id','name','type','sourceType','title'].includes(key)) && typeof column.sourceType === 'string' && /^[A-Z_]{1,64}$/.test(column.sourceType) && typeof column.title === 'string' && column.title.length <= 128 && !column.title.includes('\0')), 'smartsheet_invalid_snapshot')
 requireValue(Array.isArray(value.rowIds) && value.rowIds.length > 0 && value.rowIds.length <= SMARTSHEET_LIMITS.rows && value.rowIds.every(safeId) && new Set(value.rowIds).size === value.rowIds.length && Array.isArray(value.formulas) && value.formulas.length <= value.rowIds.length * selected.length, 'smartsheet_invalid_snapshot')
 const cells = new Set()
 for (const formula of value.formulas) {
  requireValue(object(formula) && Object.keys(formula).every(key => ['rowId','columnId','formula','cached'].includes(key)) && safeId(formula.rowId) && value.rowIds.includes(formula.rowId) && selected.some(column => column.id === formula.columnId) && typeof formula.formula === 'string' && formula.formula.length <= 4096 && !formula.formula.includes('\0') && (formula.cached === null || typeof formula.cached === 'string' && formula.cached.length <= 4096) && !cells.has(formula.rowId+':'+formula.columnId), 'smartsheet_invalid_snapshot')
  cells.add(formula.rowId+':'+formula.columnId)
 }
 return value as Snapshot
}
/** Check original JSON number tokens before JSON.parse can round them. Decimal
 * round trips must preserve the mathematical decimal, and integer magnitudes
 * must remain safe. Strings are skipped, including escaped quotation marks. */
export function preciseNumbers(text: string): void {
 const canonical = (literal: string): string => {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal)!
  let digits = (match[2]+(match[3] ?? '')).replace(/^0+/, '') || '0', power = Number(match[4] ?? 0) - (match[3]?.length ?? 0)
  requireValue(Number.isSafeInteger(power) && Math.abs(power) <= 400, 'smartsheet_unsafe_numeric_precision', 502)
  while (digits.length > 1 && digits.endsWith('0')) { digits = digits.slice(0,-1); power++ }
  return (digits === '0' ? '' : match[1])+digits+'e'+(digits === '0' ? 0 : power)
 }
 for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)) {
  if (!match[1]) continue
  const number = Number(match[1])
  requireValue(Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)) && canonical(match[1]) === canonical(String(number)), 'smartsheet_unsafe_numeric_precision', 502)
 }
}
