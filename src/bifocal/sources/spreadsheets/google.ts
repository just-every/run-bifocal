import { cellName, cellText, object, requireRange, type Coordinates, type Formula, type RangeData } from './protocol'

export function googleEndpoint(c: Coordinates): URL {
 const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${c.workbook}`)
 url.searchParams.set('ranges', `'${c.sheet.replace(/'/g, "''")}'!${c.range}`)
 url.searchParams.set('fields', 'spreadsheetId,sheets(properties(title),data(startRow,startColumn,rowData(values(formattedValue,effectiveValue,userEnteredValue))))')
 return url
}
/** Grid data keeps formula and effective value in the same provider read. */
export function googleData(value: unknown, c: Coordinates): RangeData {
 requireRange(object(value) && value.spreadsheetId === c.workbook && Array.isArray(value.sheets) && value.sheets.length === 1)
 const sheet = value.sheets[0]
 requireRange(object(sheet) && object(sheet.properties) && sheet.properties.title === c.sheet && Array.isArray(sheet.data) && sheet.data.length === 1)
 const grid = sheet.data[0]
 requireRange(object(grid) && (grid.startRow ?? 0) === c.startRow && (grid.startColumn ?? 0) === c.startColumn)
 const rowData = grid.rowData ?? []
 requireRange(Array.isArray(rowData) && rowData.length <= c.rows)
 const formulas: Formula[] = []
 const rows = Array.from({ length: c.rows }, (_, r) => {
  const row = rowData[r] ?? {}
  requireRange(object(row))
  const values = row.values ?? []
  requireRange(Array.isArray(values) && values.length <= c.columns)
  return Array.from({ length: c.columns }, (_, col) => {
   const cell = values[col] ?? {}
   requireRange(object(cell))
   const entered = cell.userEnteredValue, effective = cell.effectiveValue
   requireRange(entered === undefined || object(entered))
   requireRange(effective === undefined || object(effective) && !Object.hasOwn(effective, 'errorValue'))
   const formula = object(entered) ? entered.formulaValue : undefined
   requireRange(formula === undefined || typeof formula === 'string' && formula.startsWith('=') && formula.length <= 4096)
   // Missing caches cannot silently become null or invented values.
   requireRange(formula === undefined || object(effective) && Object.keys(effective).some(key => ['stringValue','numberValue','boolValue'].includes(key)))
   requireRange(cell.formattedValue !== undefined || effective === undefined && entered === undefined)
   const text = cellText(cell.formattedValue ?? '')
   if (typeof formula === 'string') formulas.push({ cell: cellName(c, r, col), formula, cached: text })
   return text
  })
 })
 return { rows, formulas }
}
