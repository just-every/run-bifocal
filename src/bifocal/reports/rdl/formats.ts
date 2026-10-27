import { strToU8, zipSync } from 'fflate'
import { encodePdf } from '../../dashboards/snapshots/pdf'
import { encodePptx } from '../../dashboards/snapshots/pptx'
import { fail } from '../../query/types'
import type { ReadableReport } from './layout'
import type { ReportCell } from './values'
export const formats = ['pdf', 'pptx', 'xlsx', 'docx', 'csv'] as const
export type ReportFormat = typeof formats[number]
const xml = (value: string) => {
 if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(value)) fail('rdl_xml_character_unsupported')
 return value.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]!))
}
const packageXml = (parts: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value)])))
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
  const ref = (index: number) => {let value = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(65 + (n - 1) % 26) + value; return value}
  const cell = (cell: ReportCell, r: string) => {
   if (cell.value === null) return `<c r="${r}"/>`
   if (cell.type === 'number') {
    const number = String(cell.value)
    if (!/^-?\d+(?:\.\d+)?$/.test(number) || number.replace(/[^0-9]/g, '').replace(/^0+/, '').length > 15) fail('rdl_xlsx_numeric_precision_limit')
    return `<c r="${r}" t="n"><v>${number}</v></c>`
   }
   if (cell.type === 'boolean') return `<c r="${r}" t="b"><v>${cell.value ? 1 : 0}</v></c>`
   if (cell.type === 'date') return `<c r="${r}" t="d"><v>${xml(String(cell.value))}</v></c>`
   return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${xml(String(cell.value))}</t></is></c>`
  }
  const data = run.rows.map((row, index) => `<row r="${index + 1}">${row.cells.map((value, col) => cell(value, ref(col) + (index + 1))).join('')}</row>`).join('')
  return {bytes: packageXml({
   '[Content_Types].xml': `<Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
   '_rels/.rels': relationships('xl/workbook.xml'),
   'xl/workbook.xml': `<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="r1"/></sheets></workbook>`,
   'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="r1" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
   'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`,
  }), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
 }
 const paragraph = (value: string) => `<w:p><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`
 const pages = run.pages.map((page, index) => (index ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') + page.shapes.map(shape => shape.kind === 'text' ? shape.lines.map(paragraph).join('') : '').join('')).join('')
 return {bytes: packageXml({
  '[Content_Types].xml': `<Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  '_rels/.rels': relationships('word/document.xml'),
  'word/document.xml': `<w:document xmlns:w="${ns}wordprocessingml/2006/main"><w:body>${pages}<w:sectPr><w:pgSz w:w="${Math.round(run.pageSize.width * 20)}" w:h="${Math.round(run.pageSize.height * 20)}"/></w:sectPr></w:body></w:document>`,
 }), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
}
