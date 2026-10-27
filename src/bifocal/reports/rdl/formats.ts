import { strToU8, zipSync } from 'fflate'
import { encodePdf } from '../../dashboards/snapshots/pdf'
import { encodePptx } from '../../dashboards/snapshots/pptx'
import { fail } from '../../query/types'
import type { ReadableReport, ReportRow } from './layout'
import type { ReportCell } from './values'
export const formats = ['pdf', 'pptx', 'xlsx', 'docx', 'csv'] as const
export type ReportFormat = typeof formats[number]
const xml = (value: string) => {
 if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(value)) fail('rdl_xml_character_unsupported')
 return value.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]!))
}
const packageXml = (parts: Record<string, string>, exportedAt: string) => zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value)])), {mtime: new Date(exportedAt)})
const ns = 'http://schemas.openxmlformats.org/'
const relationships = (target: string) => `<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="r1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`

export function encodeReport(run: ReadableReport, format: ReportFormat): {bytes: Uint8Array; type: string} {
 if (format === 'pdf') return {bytes: encodePdf(run), type: 'application/pdf'}
 if (format === 'pptx') return {bytes: encodePptx(run), type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}
 if (format === 'csv') {
  const quote = (cell: ReportCell) => {let value = cell.value === null ? '' : String(cell.value); if (cell.type === 'text' && /^\s*[=+@-]/.test(value)) value = "'" + value; return '"' + value.replace(/"/g, '""') + '"'}
  return {bytes: strToU8(run.rows.map(row => row.cells.map(quote).join(',')).join('\r\n') + '\r\n'), type: 'text/csv; charset=utf-8'}
 }
 if (format === 'xlsx') {
  const formats = [...new Set(run.rows.flatMap(row => row.cells.flatMap(cell => cell.format ? [cell.format] : [])))], codes = formats.map(format => {
   const kind = format[0].toUpperCase(), zeros = Number(format[1]) ? '.' + '0'.repeat(Number(format[1])) : ''
   return (kind === 'C' ? '$' : '') + (['C', 'N'].includes(kind) ? '#,##0' : '0') + zeros + (kind === 'P' ? '%' : '')
  })
  const ref = (index: number) => {let value = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(65 + (n - 1) % 26) + value; return value}
  const cell = (cell: ReportCell, r: string) => {
   if (cell.value === null) return `<c r="${r}"/>`
   if (cell.type === 'number') {
    const number = String(cell.value)
    if (!/^-?\d+(?:\.\d+)?$/.test(number) || number.replace(/[^0-9]/g, '').replace(/^0+/, '').length > 15) fail('rdl_xlsx_numeric_precision_limit')
    return `<c r="${r}" t="n"${cell.format ? ` s="${formats.indexOf(cell.format) + 1}"` : ''}><v>${number}</v></c>`
   }
   if (cell.type === 'boolean') return `<c r="${r}" t="b"><v>${cell.value ? 1 : 0}</v></c>`
   if (cell.type === 'date') return `<c r="${r}" t="d"><v>${xml(String(cell.value))}</v></c>`
   return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${xml(String(cell.value))}</t></is></c>`
  }
  const data = run.rows.map((row, index) => `<row r="${index + 1}">${row.cells.map((value, col) => cell(value, ref(col) + (index + 1))).join('')}</row>`).join('')
  return {bytes: packageXml({
   '[Content_Types].xml': `<Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
   '_rels/.rels': relationships('xl/workbook.xml'),
   'xl/workbook.xml': `<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="r1"/></sheets></workbook>`,
   'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="r1" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
   'xl/styles.xml': `<styleSheet xmlns="${ns}spreadsheetml/2006/main"><numFmts count="${codes.length}">${codes.map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(code)}"/>`).join('')}</numFmts><fonts count="1"><font><sz val="13"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${codes.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${codes.map((_, i) => `<xf numFmtId="${164 + i}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')}</cellXfs></styleSheet>`,
   'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`,
  }, run.exportedAt), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
 }
 const paragraph = (value: string) => `<w:p><w:pPr><w:spacing w:after="0" w:line="325" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="26"/></w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`
 const table = (rows: ReportRow[]) => rows.map(row => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tr><w:trPr><w:cantSplit/></w:trPr>${row.cells.map(cell => `<w:tc>${paragraph(cell.display)}</w:tc>`).join('')}</w:tr></w:tbl>`).join('')
 const pages = run.pages.map((_, index) => (index ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') + table(run.furniture.header) + table(run.pageRows[index]) + table(run.furniture.footer) + paragraph('Page ' + (index + 1) + ' of ' + run.pages.length)).join('')
 return {bytes: packageXml({
  '[Content_Types].xml': `<Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  '_rels/.rels': relationships('word/document.xml'),
  'word/document.xml': `<w:document xmlns:w="${ns}wordprocessingml/2006/main"><w:body>${pages}<w:sectPr><w:pgMar w:top="${Math.round(run.pageMargins.top * 20)}" w:bottom="${Math.round(run.pageMargins.bottom * 20)}" w:left="${Math.round(run.pageMargins.left * 20)}" w:right="${Math.round(run.pageMargins.right * 20)}"/><w:pgSz w:w="${Math.round(run.pageSize.width * 20)}" w:h="${Math.round(run.pageSize.height * 20)}"/></w:sectPr></w:body></w:document>`,
 }, run.exportedAt), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
}
