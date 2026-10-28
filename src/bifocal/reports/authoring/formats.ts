import { strToU8, zipSync } from 'fflate'
import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { decimal, rational } from '../../currency/decimal.ts'
import { fail } from '../../query/types.ts'
import { NATIVE_REPORT_LIMITS, type NativeReportCell, type NativeReportColumn, type NativeReportDefinition, type NativeReportManifest, type NativeReportRow } from './types.ts'

const namespace = (...parts: string[]) => ['http:', '', 'schemas.openxmlformats.org', ...parts].join('/')
const sheetNs = namespace('spreadsheetml', '2006', 'main'), packageRels = namespace('package', '2006', 'relationships'), documentRels = namespace('officeDocument', '2006', 'relationships')
const contentTypes = namespace('package', '2006', 'content-types')
const mediaType = (subtype: string) => ['application', subtype].join('/')
const xml = (value: string) => {
 if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(value)) fail('native_report_xml_character_unsupported')
 return value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[character]!))
}
export function boundedBytes(bytes: Uint8Array, format: 'pdf' | 'xlsx' | 'csv'): Uint8Array {
 if (bytes.byteLength > NATIVE_REPORT_LIMITS.bytes) fail('native_report_' + format + '_byte_limit')
 return bytes
}
/** Excel keeps at most fifteen significant decimal digits. Refuse a lossy cell. */
function excelNumber(value: string): string {
 const exact = decimal(value), significant = value.replace(/[-.]/g, '').replace(/^0+/, '').replace(/0+$/, '')
 if (significant.length > 15) fail('native_report_xlsx_numeric_precision_limit')
 const converted = Number(value)
 if (!Number.isFinite(converted)) fail('native_report_xlsx_numeric_precision_limit')
 const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(converted))!
 const fraction = match[3] ?? '', power = Number(match[4] ?? 0) - fraction.length
 const coefficient = BigInt((match[1] || '') + match[2] + fraction)
 const recovered = power >= 0 ? rational(coefficient * 10n ** BigInt(power)) : rational(coefficient, 10n ** BigInt(-power))
 if (exact.numerator !== recovered.numerator || exact.denominator !== recovered.denominator) fail('native_report_xlsx_numeric_precision_limit')
 return value
}
const columnRef = (index: number) => {
 let result = ''
 for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result
 return result
}
const cellXml = (cell: NativeReportCell, ref: string, style: number): string => {
 if (cell.value === null) return `<c r="${ref}" s="${style}"/>`
 if (cell.type === 'number' || cell.type === 'money') return `<c r="${ref}" t="n" s="${style}"><v>${excelNumber(String(cell.value))}</v></c>`
 if (cell.type === 'boolean') return `<c r="${ref}" t="b" s="${style}"><v>${cell.value ? 1 : 0}</v></c>`
 if (cell.type === 'date') return `<c r="${ref}" t="d" s="${style}"><v>${xml(String(cell.value))}</v></c>`
 return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(String(cell.value))}</t></is></c>`
}
export function encodeNativeCsv(columns: NativeReportColumn[], rows: NativeReportRow[]): Uint8Array {
 const quote = (cell: NativeReportCell) => {
  let value = cell.value === null ? '' : String(cell.value)
  if (cell.type === 'text' && /^\s*[=+@-]/.test(value)) value = "'" + value
  return '"' + value.replace(/"/g, '""') + '"'
 }
 const heading = columns.map(column => ({type: 'text' as const, value: column.name, display: column.name}))
 return boundedBytes(strToU8([heading, ...rows.map(row => row.cells)].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'), 'csv')
}
export function encodeNativeXlsx(definition: NativeReportDefinition, columns: NativeReportColumn[], rows: NativeReportRow[], manifest: NativeReportManifest): Uint8Array {
 const numberFormats = [...new Set(columns.filter(column => column.scale !== undefined).map(column => column.scale!))]
 const styles = columns.map(column => column.scale !== undefined ? numberFormats.indexOf(column.scale) + 1 : 0)
 const heading = columns.map(column => ({type: 'text' as const, value: column.name, display: column.name}))
 const data = [heading, ...rows.map(row => row.cells)].map((cells, index) => `<row r="${index + 1}">${cells.map((cell, col) => cellXml(cell, columnRef(col) + (index + 1), index ? styles[col] : 0)).join('')}</row>`).join('')
 const header = (definition.title + (definition.header ? '\n' + definition.header : '')).replace(/&/g, '&&')
 const footer = definition.footer.replace(/&/g, '&&') + (definition.footer ? '\n' : '') + 'Page &P of &N'
 if (header.length > 255 || footer.length > 255) fail('native_report_xlsx_header_footer_limit')
 const parts: Record<string, string> = {
  '[Content_Types].xml': `<Types xmlns="${contentTypes}"><Default Extension="rels" ContentType="${mediaType('vnd.openxmlformats-package.relationships+xml')}"/><Default Extension="xml" ContentType="${mediaType('xml')}"/><Default Extension="json" ContentType="${mediaType('json')}"/><Override PartName="/xl/workbook.xml" ContentType="${mediaType('vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')}"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${mediaType('vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')}"/><Override PartName="/xl/styles.xml" ContentType="${mediaType('vnd.openxmlformats-officedocument.spreadsheetml.styles+xml')}"/></Types>`,
  '_rels/.rels': `<Relationships xmlns="${packageRels}"><Relationship Id="r1" Type="${documentRels + '/officeDocument'}" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml': `<workbook xmlns="${sheetNs}" xmlns:r="${documentRels}"><sheets><sheet name="Report" sheetId="1" r:id="r1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'Report'!$1:$1</definedName></definedNames></workbook>`,
  'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${packageRels}"><Relationship Id="r1" Type="${documentRels + '/worksheet'}" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${documentRels + '/styles'}" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml': `<styleSheet xmlns="${sheetNs}"><numFmts count="${numberFormats.length}">${numberFormats.map((scale, index) => `<numFmt numFmtId="${164 + index}" formatCode="0${scale ? '.' + '0'.repeat(scale) : ''}"/>`).join('')}</numFmts><fonts count="1"><font><sz val="13"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${numberFormats.length + 1}">${[0, ...numberFormats.map((_, index) => 164 + index)].map(id => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}</cellXfs></styleSheet>`,
  'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${data}</sheetData><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.25" footer="0.25"/><pageSetup paperSize="1" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddHeader>${xml(header)}</oddHeader><oddFooter>${xml(footer)}</oddFooter></headerFooter></worksheet>`,
 }
 const files: Record<string, Uint8Array> = Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value)]))
 files['bifocal-provenance.json'] = strToU8(canonicalJson(manifest))
 return boundedBytes(zipSync(files, {level: 6, mtime: new Date('2000-01-01T00:00:00Z')}), 'xlsx')
}
