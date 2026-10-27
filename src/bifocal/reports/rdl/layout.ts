import type { Scene } from '../../dashboards/snapshots/scene'
import { fail } from '../../query/types'
import type { ReportCell } from './values'
export type ReportRow = {cells: ReportCell[]; widths: number[]; location: string; page?: number}
export type ReadableReport = {pages: Scene[]; rows: ReportRow[]; pageRows: ReportRow[][]; pageSize: {width: number; height: number}; pageMargins: {top: number; bottom: number; left: number; right: number}; furniture: {header: ReportRow[]; footer: ReportRow[]}; provenance: unknown; exportedAt: string; backLink: string}
export function length(value: string, fallback: number) {
 if (!value) return fallback
 const match = /^(\d+(?:\.\d+)?)(in|cm|mm|pt|pc)$/.exec(value.trim())
 if (!match) fail('rdl_page_length_unsupported')
 return Number(match[1]) * ({in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1, pc: 12}[match[2]]!)
}
export function wrap(value: string, width: number, size = 13) {
 // This bound exceeds every supported standard-font glyph advance. A wide
 // glyph such as W must never escape a column after a character-count wrap.
 if ([...value].some(c => c !== '\n' && (c.charCodeAt(0) < 32 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159 || c.charCodeAt(0) > 255 && !'€–—‘’“”…'.includes(c)))) fail('rdl_readable_character_unsupported')
 const result: string[] = [], max = Math.floor(width / (size * 1.1))
 if (max < 1) fail('rdl_readable_column_too_narrow')
 for (const paragraph of value.split('\n')) {
  let line = ''
  for (const word of paragraph.split(/\s+/)) {
   if (word.length > max) fail('rdl_readable_unbreakable_text')
   if (line && line.length + 1 + word.length > max) {result.push(line); line = word}
   else line += (line ? ' ' : '') + word
  }
  result.push(line)
 }
 return result
}

/** The explicitly selected readable layout keeps rows whole and repeats the
 * report furniture and declared static table headings on continuation pages. */
export function reportLayout(options: {width: number; height: number; left: number; right: number; top: number; bottom: number; header: ReportRow[]; footer: ReportRow[]}) {
 const {width, height, left, right, top, bottom, header, footer} = options, usable = width - left - right
 if (![width, height, left, right, top, bottom].every(Number.isFinite) || width < 200 || height < 250 || width > 1600 || height > 2400 || Math.min(left, right, top, bottom) < 0 || usable < 150) fail('rdl_page_geometry_unsupported')
 const pages: Scene[] = [], rows: ReportRow[] = [], pageRows: ReportRow[][] = []
 const measure = (row: ReportRow) => {
  if (!row.cells.length || row.cells.length !== row.widths.length || row.widths.some(w => !Number.isFinite(w) || w <= 0)) fail('rdl_row_geometry_unsupported')
  const sum = row.widths.reduce((a, b) => a + b, 0), widths = row.widths.map(w => usable * w / sum)
  const lines = row.cells.map((cell, i) => wrap(cell.display, widths[i] - 12))
  return {widths, lines, height: Math.max(...lines.map(l => l.length)) * 16.25 + 10}
 }
 const headerHeight = header.reduce((n, row) => n + measure(row).height, 0), footerHeight = footer.reduce((n, row) => n + measure(row).height, 0) + 22
 const bodyTop = top + headerHeight, bodyBottom = height - bottom - footerHeight
 if (bodyBottom - bodyTop < 100) fail('rdl_page_furniture_does_not_fit')
 let page: Scene, y = bodyTop, repeat: ReportRow[] = [], bodyRows = 0
 const draw = (row: ReportRow, at: number) => {
  const measured = measure(row); let x = left
  measured.lines.forEach((lines, i) => {
   page.shapes.push({kind: 'text', x: x + 6, y: at + 5, w: measured.widths[i] - 12, h: measured.height - 10, size: 13, lines, label: row.cells[i].location})
   x += measured.widths[i]
  })
  return measured.height
 }
 const begin = () => {
  if (pages.length >= 200) fail('rdl_interactive_page_limit', 413)
  page = {title: 'Report page ' + (pages.length + 1), tab: String(pages.length + 1), shapes: []}; pages.push(page); pageRows.push([]); y = bodyTop; bodyRows = 0
  let offset = top; for (const row of header) offset += draw(row, offset)
  for (const row of repeat) {if (y + measure(row).height > bodyBottom - 40) fail('rdl_repeated_headings_do_not_fit'); y += draw(row, y); pageRows.at(-1)!.push({...row, page: pages.length})}
 }
 begin()
 return {
  row(row: ReportRow) {
   if (rows.length >= 12000) fail('rdl_interactive_layout_limit', 413)
   const h = measure(row).height
   if (h > bodyBottom - bodyTop - repeat.reduce((n, r) => n + measure(r).height, 0)) fail('rdl_readable_row_does_not_fit')
   if (y + h > bodyBottom) begin()
   y += draw(row, y); const positioned = {...row, page: pages.length}; rows.push(positioned); pageRows.at(-1)!.push(positioned); bodyRows++
  },
  repeat(rows: ReportRow[]) {repeat = rows},
  break() {if (bodyRows) begin()},
  finish() {
   pages.forEach((p, i) => {
    page = p; let offset = height - bottom - footerHeight
    for (const row of footer) offset += draw(row, offset)
    page.shapes.push({kind: 'text', x: left + 6, y: height - bottom - 20, w: usable - 12, h: 18, size: 13, lines: ['Page ' + (i + 1) + ' of ' + pages.length], label: 'Readable page number'})
   })
   return {pages, rows, pageRows, pageSize: {width, height}, pageMargins: {top, bottom, left, right}, furniture: {header, footer}}
  },
 }
}
