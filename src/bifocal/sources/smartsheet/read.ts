import { Buffer } from 'node:buffer'
import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { AnalyticsError, object, providerJson, requireValue } from '../analytics/protocol'
import { SMARTSHEET_LIMITS as limits, SMARTSHEET_SPEC, preciseNumbers, providerId, type Selection, type Snapshot } from './protocol'
export class SmartsheetError extends AnalyticsError {
 constructor(code: string, readonly details: { columnId: string; sourceType?: string; rowId?: string }) { super(code, 502) }
}
const base = 'https://api.smartsheet.com/2.0/sheets/'
const get = (path: string, grant: string) => providerJson(base+path, grant, undefined, preciseNumbers)
const plainText = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096 && !value.includes('\0')
function scalar(cell: Record<string,unknown>, column: Snapshot['columns'][number], rowId: string): string | null {
 const fail = (code: string): never => { throw new SmartsheetError(code, { rowId, columnId:column.id, sourceType:column.sourceType }) }
 if (cell.objectValue !== undefined && cell.objectValue !== cell.value && !(column.type === 'date' && object(cell.objectValue) && cell.objectValue.objectType === 'DATE' && cell.objectValue.value === cell.value && Object.keys(cell.objectValue).every(key=>['objectType','value'].includes(key)))) fail('smartsheet_unsupported_cell_value')
 if (cell.image !== undefined || cell.hyperlink !== undefined || cell.linkInFromCell !== undefined || cell.linksOutToCells !== undefined) fail('smartsheet_unsupported_cell_value')
 const value = cell.value
 if (value === undefined || value === null) return null
 if (column.type === 'text') { if (!plainText(value)) fail('smartsheet_text_required'); return value as string }
 if (column.type === 'boolean') { if (typeof value !== 'boolean') fail('smartsheet_boolean_required'); return String(value) }
 if (column.type === 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) fail('smartsheet_date_required')
  return (value as string).slice(5,7)+'/'+(value as string).slice(8,10)+'/'+(value as string).slice(0,4)
 }
 const decimal = typeof value === 'number' ? String(value) : value
 if (!plainText(decimal) || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimal as string)) fail('smartsheet_decimal_required')
 if (column.type === 'money') {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(decimal as string)) fail('smartsheet_usd_precision_required')
  const [whole, fraction=''] = (decimal as string).split('.')
  return whole+'.'+fraction.padEnd(2,'0')
 }
 return decimal as string
}
export async function readSheet(sheetId: string, selected: Selection[], grant: string) {
 const rows: (string|null)[][] = [], rowIds: string[] = [], seen = new Set<string>(), formulas: Snapshot['formulas'] = []
 let columns: Snapshot['columns'] = [], version = -1, total = -1, byteCount = 0
 for (let page=1; page<=limits.pages; page++) {
  const result = await get(sheetId+'?'+new URLSearchParams({level:'2',include:'objectValue',columnIds:selected.map(column=>column.id).join(','),pageSize:String(limits.pageSize),page:String(page)}), grant)
  requireValue(providerId(result.id) === sheetId && Number.isSafeInteger(result.version) && Number(result.version) >= 0 && Number.isSafeInteger(result.totalRowCount) && Number(result.totalRowCount) >= 0 && Array.isArray(result.columns) && Array.isArray(result.rows), 'smartsheet_sheet_schema_mismatch', 502)
  requireValue(Number(result.totalRowCount) <= limits.rows, 'smartsheet_row_limit', 413)
  requireValue(Number(result.totalRowCount) > 0, 'smartsheet_empty_sheet', 422)
  requireValue(result.columns.length === selected.length, 'smartsheet_selected_columns_missing', 502)
  const ids = result.columns.map(column => { requireValue(object(column), 'smartsheet_column_schema_mismatch', 502); return providerId(column.id) })
  requireValue(new Set(ids).size === selected.length && selected.every(column => ids.includes(column.id)), 'smartsheet_selected_columns_missing', 502)
  const current = selected.map(selection => {
   const column = (result.columns as Record<string,unknown>[]).find(column => String(column.id) === selection.id)!
   requireValue(typeof column.type === 'string' && /^[A-Z_]{1,64}$/.test(column.type) && typeof column.title === 'string' && column.title.length <= 128 && !column.title.includes('\0'), 'smartsheet_column_schema_mismatch', 502)
   const allowed = selection.type === 'date' ? ['DATE'] : selection.type === 'boolean' ? ['CHECKBOX'] : selection.type === 'text' ? ['TEXT_NUMBER','PICKLIST'] : ['TEXT_NUMBER']
   if (!allowed.includes(column.type) || column.systemColumnType !== undefined) throw new SmartsheetError('smartsheet_unsupported_column_type', {columnId:selection.id,sourceType:column.type})
   return {...selection,sourceType:column.type,title:column.title}
  })
  if (page === 1) { columns=current; version=Number(result.version); total=Number(result.totalRowCount) }
  requireValue(result.version === version && result.totalRowCount === total && canonicalJson(current) === canonicalJson(columns), 'smartsheet_version_drift', 409)
  requireValue(result.rows.length === Math.min(limits.pageSize,total-rowIds.length), 'smartsheet_incomplete_rows', 502)
  for (const row of result.rows) {
   requireValue(object(row) && Array.isArray(row.cells) && row.cells.length === selected.length, 'smartsheet_row_schema_mismatch', 502)
   const rowId = providerId(row.id)
   requireValue(!seen.has(rowId) && row.rowNumber === rowIds.length+1, 'smartsheet_incomplete_rows', 502)
   const cellIds = row.cells.map(cell => { requireValue(object(cell), 'smartsheet_cell_schema_mismatch', 502); return providerId(cell.columnId) })
   requireValue(new Set(cellIds).size === selected.length && selected.every(column=>cellIds.includes(column.id)), 'smartsheet_incomplete_cells', 502)
   const values = columns.map(column => {
    const cell = (row.cells as Record<string,unknown>[]).find(cell => String(cell.columnId) === column.id)!
    const value = scalar(cell,column,rowId)
    if (cell.formula !== undefined) {
     requireValue(plainText(cell.formula), 'smartsheet_formula_limit', 502)
     const formula = {rowId,columnId:column.id,formula:cell.formula,cached:value}
     byteCount += Buffer.byteLength(JSON.stringify(formula)); formulas.push(formula)
    }
    return value
   })
   byteCount += Buffer.byteLength(JSON.stringify(values))+rowId.length
   requireValue(byteCount <= limits.bytes, 'smartsheet_snapshot_limit', 413)
   rows.push([rowId,...values]); rowIds.push(rowId); seen.add(rowId)
  }
  if (rowIds.length === total) break
 }
 requireValue(rowIds.length === total, 'smartsheet_incomplete_rows', 502)
 const final = await get(sheetId+'/version',grant)
 requireValue(final.version === version, 'smartsheet_version_drift', 409)
 // Choose a collision-free null marker so a literal empty string stays text.
 let nullValue = '~bifocal-null~'
 while (rows.some(row => row.includes(nullValue))) nullValue += '~'
 const snapshot: Snapshot = {sheetId,version,observedAt:new Date().toISOString(),spec:SMARTSHEET_SPEC.sha256,columns,rowIds,formulas}
 return {rows:[['smartsheet_row_id',...selected.map(column=>column.name)],...rows.map(row=>row.map(value=>value === null ? nullValue : value))],columns:Object.fromEntries([['smartsheet_row_id','text'],...selected.map(column=>[column.name,column.type])]),snapshot,nullValue}
}
