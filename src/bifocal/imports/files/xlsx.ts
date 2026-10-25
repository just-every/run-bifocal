import { Buffer } from 'node:buffer'
import { DOMParser, type Document, type Element } from '@xmldom/xmldom'
import { unzipSync } from 'fflate'
import { sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { FILE_LIMITS, WORKBOOK_LIMITS, originalBase64Limit } from './limits'

export class WorkbookError extends Error {}
function refuse(reason: string): never { throw new WorkbookError(reason) }
const XML_NS = ['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']
const children = (element: Element, name: string): Element[] => Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1 && node.localName === name)
const all = (document: Document, name: string) => Array.from(document.getElementsByTagNameNS('*', name))
const attr = (element: Element, name: string) => element.getAttribute(name) ?? ''
function xml(bytes: Uint8Array): Document {
 let source: string
 try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { refuse('XLSX_ENCODING: Workbook XML must be valid UTF-8.') }
 if (/<!\s*(DOCTYPE|ENTITY)/i.test(source)) refuse('XLSX_ACTIVE_XML: DTDs and entity declarations are not supported.')
 let document: Document
 try { document = new DOMParser({ onError: () => { throw Error('invalid XML') } }).parseFromString(source, 'application/xml') } catch { refuse('XLSX_XML: Repair the malformed workbook XML before importing.') }
 if (!document.documentElement) refuse('XLSX_XML: An XML document has no root element.')
 const stack = [{ node: document.documentElement, depth: 1 }]; let count = 0
 while (stack.length) {
  const { node, depth } = stack.pop()!
  if (++count > WORKBOOK_LIMITS.xmlNodes || depth > WORKBOOK_LIMITS.xmlDepth) refuse('XLSX_XML_LIMIT: Workbook XML exceeds the node or nesting bound.')
  for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) stack.push({ node: child as Element, depth: depth + 1 })
 }
 return document
}
/** Inspect the central AND local directory before inflating any bytes. No files
 * are extracted. ZIP64, encryption, traversal, overlapping entries and excessive
 * advertised expansion are refused before the ZIP decoder allocates output. */
function parts(bytes: Uint8Array): Record<string, Uint8Array> {
 if (!bytes.length || bytes.length > WORKBOOK_LIMITS.bytes) refuse(`XLSX_BYTE_LIMIT: Workbooks must be at most ${WORKBOOK_LIMITS.bytes} compressed bytes.`)
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
 const u16 = (at: number) => view.getUint16(at, true), u32 = (at: number) => view.getUint32(at, true)
 let end = -1
 for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break }
 if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) refuse('XLSX_ZIP: Supply a complete single-disk XLSX ZIP archive.')
 const count = u16(end + 10), offset = u32(end + 16), size = u32(end + 12)
 if (!count || count > WORKBOOK_LIMITS.entries || offset + size !== end) refuse(`XLSX_ZIP_LIMIT: At most ${WORKBOOK_LIMITS.entries} ordinary ZIP entries are supported.`)
 const expected = new Map<string, { size: number; crc: number }>(), names = new Set<string>(), ranges: { start: number; end: number }[] = []; let at = offset, total = 0
 for (let index = 0; index < count; index++) {
  if (at + 46 > end || u32(at) !== 0x02014b50) refuse('XLSX_ZIP: The central directory is incomplete.')
  const flags = u16(at + 8), method = u16(at + 10), packed = u32(at + 20), expanded = u32(at + 24), length = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), local = u32(at + 42)
  if (at + 46 + length + extra + comment > end || (flags & ~0x0808) || ![0,8].includes(method) || u16(at + 34) || expanded > WORKBOOK_LIMITS.entryBytes || (total += expanded) > WORKBOOK_LIMITS.expandedBytes) refuse('XLSX_ZIP_LIMIT: Unsupported compression, encryption, ZIP64 or expanded size.')
  let name: string
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + length)) } catch { refuse('XLSX_ZIP_PATH: Entry names must be valid UTF-8.') }
  if (!name || name.startsWith('/') || /[\\\x00-\x1f:]/.test(name) || name.split('/').some(part => ['..','.','__proto__','constructor','prototype'].includes(part)) || names.has(name) || ((u32(at + 38) >>> 16) & 0xf000) === 0xa000) refuse('XLSX_ZIP_PATH: Duplicate, unsafe or symbolic-link entries are refused.')
  if (/vba|activex|macrosheets|embeddings\/|\.bin$/i.test(name)) refuse('XLSX_ACTIVE_CONTENT: Macros, embedded binaries and active controls are not supported.')
  if (local + 30 > offset || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) refuse('XLSX_ZIP: A local entry does not match its directory record.')
  const localLength = u16(local + 26), localExtra = u16(local + 28), data = local + 30 + localLength + localExtra
  if (data + packed > offset || localLength !== length || bytes.subarray(local + 30, local + 30 + localLength).some((byte, i) => byte !== bytes[at + 46 + i]) || (!(flags & 8) && (u32(local + 18) !== packed || u32(local + 22) !== expanded))) refuse('XLSX_ZIP: Entry sizes, names or offsets do not match.')
  ranges.push({ start: local, end: data + packed }); names.add(name); expected.set(name, { size: expanded, crc: u32(at + 16) }); at += 46 + length + extra + comment
 }
 if (at !== end) refuse('XLSX_ZIP: Trailing central-directory data is not supported.')
 ranges.sort((a,b) => a.start - b.start)
 if (ranges.some((range, i) => i && range.start < ranges[i - 1].end)) refuse('XLSX_ZIP: Overlapping entries are refused.')
 let result: Record<string, Uint8Array>
 try { result = unzipSync(bytes) } catch { refuse('XLSX_ZIP: Workbook decompression failed; re-export the file.') }
 if (Object.keys(result).length !== count || Object.entries(result).some(([name, data]) => !names.has(name) || data.length !== expected.get(name)?.size || crc32(data) !== expected.get(name)?.crc) || Object.values(result).reduce((sum, data) => sum + data.length, 0) > WORKBOOK_LIMITS.expandedBytes) refuse('XLSX_ZIP_LIMIT: Decompressed data exceeds the declared bounds.')
 return result
}
function crc32(bytes: Uint8Array): number {
 let crc = 0xffffffff
 for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
 return (crc ^ 0xffffffff) >>> 0
}
function coordinate(reference: string): { row: number; col: number } {
 const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference)
 if (!match) refuse('XLSX_CELL: A cell has an invalid address.')
 let col = 0
 for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64
 const row = Number(match[2])
 if (col > FILE_LIMITS.columns || row > FILE_LIMITS.rows+1) refuse(`XLSX_TABLE_LIMIT: Sheets support at most ${FILE_LIMITS.columns} columns and ${FILE_LIMITS.rows} data rows within the complete-table byte bound.`)
 return { row: row - 1, col: col - 1 }
}
const dateFormats = new Set([14,15,16,17])
function excelDate(value: string, date1904: boolean): string {
 const serial = Number(value)
 if (!/^\d+$/.test(value) || !Number.isSafeInteger(serial) || serial > 2958465 || (!date1904 && serial === 60)) refuse('XLSX_DATE: Fractional dates and Excel’s fictitious 02/29/1900 require an explicit source correction.')
 const days = date1904 ? serial : serial - (serial > 60 ? 1 : 0)
 const instant = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31) + days * 86400000)
 if (instant.getUTCFullYear() > 9999) refuse('XLSX_DATE: Date is outside the supported range.')
 return `${String(instant.getUTCMonth() + 1).padStart(2,'0')}/${String(instant.getUTCDate()).padStart(2,'0')}/${instant.getUTCFullYear()}`
}
export function readWorkbook(base64: string, selected: unknown) {
 if (base64.length > originalBase64Limit(WORKBOOK_LIMITS.bytes)) refuse(`XLSX_BYTE_LIMIT: Workbooks must be at most ${WORKBOOK_LIMITS.bytes} compressed bytes.`)
 const bytes = Buffer.from(base64, 'base64')
 if (bytes.toString('base64') !== base64) refuse('XLSX_BASE64: Supply the exact canonical base64 workbook bytes.')
 const files = parts(bytes), documents = new Map<string, Document>(); let tags = 0
 for (const [name, data] of Object.entries(files)) if (/\.(xml|rels)$/.test(name)) {
  tags += Array.from(data).filter(byte => byte === 60).length
  if (tags > WORKBOOK_LIMITS.markup) refuse(`XLSX_XML_LIMIT: Workbook XML exceeds ${WORKBOOK_LIMITS.markup} markup boundaries.`)
  const document = xml(data); documents.set(name, document)
  if (all(document, 'Relationship').some(rel => attr(rel, 'TargetMode').toLowerCase() === 'external' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(attr(rel, 'Target')))) refuse('XLSX_EXTERNAL_LINK: External relationships are refused; remove linked objects or import a values-only copy.')
 }
 const content = documents.get('[Content_Types].xml'), workbook = documents.get('xl/workbook.xml'), rels = documents.get('xl/_rels/workbook.xml.rels')
 if (!content || !workbook || !rels || !XML_NS.includes(workbook.documentElement?.namespaceURI ?? '')) refuse('XLSX_STRUCTURE: The required workbook parts or spreadsheet namespace are missing.')
 if (Array.from(content.getElementsByTagName('*')).some(node => /macroenabled|vba|activex|javascript|oleobject/i.test(attr(node, 'ContentType')))) refuse('XLSX_ACTIVE_CONTENT: Active workbook content is refused.')
 const sheets = all(workbook, 'sheet'), names = sheets.map(sheet => attr(sheet, 'name'))
 if (!names.length || names.length > 32 || new Set(names).size !== names.length || typeof selected !== 'string' || !names.includes(selected)) refuse('XLSX_SHEET: Choose an exact existing sheet name; at most 32 sheets are supported.')
 const sheet = sheets[names.indexOf(selected)], rid = attr(sheet, 'r:id')
 const links = all(rels, 'Relationship').filter(rel => attr(rel, 'Id') === rid && /\/worksheet$/.test(attr(rel, 'Type')))
 if (links.length !== 1) refuse('XLSX_SHEET: The sheet relationship is missing or ambiguous.')
 const target = attr(links[0], 'Target'), path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`
 if (target.includes('..') || /[\\?#]/.test(target)) refuse('XLSX_SHEET: Unsafe sheet relationship.')
 const worksheet = documents.get(path)
 if (!worksheet || !XML_NS.includes(worksheet.documentElement?.namespaceURI ?? '')) refuse('XLSX_SHEET: The selected worksheet is missing.')
 const shared = documents.get('xl/sharedStrings.xml'), strings = shared ? all(shared, 'si').map(si => Array.from(si.getElementsByTagNameNS('*','t')).map(t => t.textContent ?? '').join('')) : []
 const styles = documents.get('xl/styles.xml'), formats = new Map<number,string>()
 for (const format of styles ? all(styles, 'numFmt') : []) formats.set(Number(attr(format,'numFmtId')), attr(format,'formatCode'))
 const xfs = styles ? all(styles, 'cellXfs')[0] : undefined, styleIds = xfs ? children(xfs, 'xf').map(xf => Number(attr(xf,'numFmtId') || '0')) : [0]
 const date1904 = all(workbook,'workbookPr').some(p => ['1','true'].includes(attr(p,'date1904')))
 type CellType = 'text' | 'number' | 'money' | 'date' | 'boolean'
 const types: Set<CellType>[] = []
 const rows: string[][] = [], formulas: { cell: string; formula: string; cached: string }[] = [], seen = new Set<string>(); let width = 0
 for (const row of all(worksheet, 'row')) for (const cell of children(row, 'c')) {
  const reference = attr(cell, 'r'), { row: r, col: c } = coordinate(reference)
  if (seen.has(reference)) refuse('XLSX_CELL: Duplicate cell address.')
  seen.add(reference); while (rows.length <= r) rows.push([])
  const vs = children(cell,'v'), fs = children(cell,'f'), type = attr(cell,'t')
  if (vs.length > 1 || fs.length > 1 || type === 'e') refuse('XLSX_CELL: Resolve formula errors or ambiguous cell values before importing.')
  let value = vs[0]?.textContent ?? '', cellType: CellType = ['s','inlineStr','str'].includes(type) ? 'text' : type === 'b' ? 'boolean' : 'number'
  if (type === 's') { if (!/^\d+$/.test(value) || Number(value) >= strings.length) refuse('XLSX_STRING: Shared-string reference is invalid.'); value = strings[Number(value)] }
  else if (type === 'inlineStr') value = children(cell,'is').map(is => Array.from(is.getElementsByTagNameNS('*','t')).map(t => t.textContent ?? '').join('')).join('')
  else if (type === 'b') { if (!['0','1'].includes(value)) refuse('XLSX_BOOLEAN: Boolean values must be 0 or 1.'); value = value === '1' ? 'true' : 'false' }
  else if (type && !['n','str'].includes(type)) refuse('XLSX_TYPE: This cell type needs an explicit supported source conversion.')
  const style = attr(cell,'s') || '0'
  if (!/^\d+$/.test(style) || Number(style) >= styleIds.length) refuse('XLSX_STYLE: The cell style is invalid.')
  const format = styleIds[Number(style)], code = formats.get(format) ?? ''
  if ((!type || type === 'n') && value) {
   if (dateFormats.has(format) || /^(?:mm?\/dd?\/yyyy|yyyy-mm-dd)$/i.test(code)) { value = excelDate(value, date1904); cellType = 'date' }
   else if ([5,6,7,8,44].includes(format) || /\$/.test(code)) { if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) refuse('XLSX_MONEY: USD values require at most two decimal places; no rounding is performed.'); const [whole, fraction = ''] = value.split('.'); value = whole + '.' + fraction.padEnd(2, '0'); value = value.startsWith('-') ? '-$' + value.slice(1) : '$' + value; cellType = 'money' }
  }
  if ((!type || type === 'n') && value && cellType === 'number') {
   if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || ![0,1,2,3,4,9,10].includes(format)) refuse('XLSX_NUMBER_FORMAT: Normalize scientific, time or unsupported custom number formats in a source copy; no implicit conversion is performed.')
  }
  if (r > 0 && value) { types[c] ??= new Set(); types[c].add(cellType) }
  if (fs.length) {
   if (!vs.length || !fs[0].textContent || fs[0].attributes.length) refuse('XLSX_FORMULA_CACHE: Recalculate formulas and expand shared/array formulas in the source before importing.')
   formulas.push({ cell: reference, formula: fs[0].textContent!, cached: value })
  }
  if (value.length > FILE_LIMITS.cell) refuse(`CELL_LIMIT: A cell exceeds ${FILE_LIMITS.cell} characters.`)
  rows[r][c] = value; width = Math.max(width, c + 1)
 }
 if (rows.length < 2) refuse('XLSX_EMPTY: Supply a header and at least one data row.')
 // Even empty string cells need two JSON bytes plus separators. Refuse an
 // impossible sparse rectangle before allocating all of its missing cells.
 if ((rows.length-1)*(width*3+1)>FILE_LIMITS.tableBytes) refuse('XLSX_TABLE_LIMIT: The complete selected rectangle cannot fit the native table byte bound.')
 for (const row of rows) for (let col = 0; col < width; col++) if (row[col] === undefined) row[col] = ''
 return { rows, types: Array.from({ length: width }, (_, i) => types[i]?.size === 1 ? [...types[i]][0] : types[i]?.size ? 'mixed' as const : null), sheet: selected, sheets: names, formulas, sha256: sha256(bytes) }
}
