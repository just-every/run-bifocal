import { cellName, cellText, object, requireRange, type Coordinates, type Formula, type RangeData } from './protocol'

const segment = (value: string) => encodeURIComponent(value).replace(/'/g, '%27')
export function microsoftEndpoint(c: Coordinates): URL {
 const url = new URL(`https://graph.microsoft.com/v1.0/me/drive/items/${segment(c.workbook)}/workbook/worksheets/${segment(c.sheet)}/range(address='${c.range}')`)
 url.searchParams.set('$select', 'address,rowCount,columnCount,rowIndex,columnIndex,text,formulas,valueTypes')
 return url
}
function matrix(value: unknown, c: Coordinates): unknown[][] {
 requireRange(Array.isArray(value) && value.length === c.rows && value.every(row => Array.isArray(row) && row.length === c.columns))
 return value as unknown[][]
}
export function microsoftData(value: unknown, c: Coordinates): RangeData {
 requireRange(object(value) && value.rowCount === c.rows && value.columnCount === c.columns && value.rowIndex === c.startRow && value.columnIndex === c.startColumn)
 const quotedSheet = `'${c.sheet.replace(/'/g, "''")}'`
 requireRange(value.address === `${c.sheet}!${c.range}` || value.address === `${quotedSheet}!${c.range}`)
 const text = matrix(value.text, c), expressions = matrix(value.formulas, c), types = matrix(value.valueTypes, c), formulas: Formula[] = []
 const rows = text.map((row, r) => row.map((raw, col) => {
  const cached = cellText(raw), formula = expressions[r][col], type = types[r][col]
  requireRange(['Empty','String','Integer','Double','Boolean'].includes(String(type)))
  requireRange(typeof formula === 'string' || typeof formula === 'boolean' || typeof formula === 'number' && Number.isFinite(formula))
  if (typeof formula === 'string') {
   requireRange(formula.length <= 4096 && !formula.includes('\0'))
   if (formula.startsWith('=')) {
    requireRange(type !== 'Empty')
    formulas.push({ cell: cellName(c, r, col), formula, cached })
   }
  }
  return cached
 }))
 return { rows, formulas }
}
