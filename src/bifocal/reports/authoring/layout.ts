import type { PrintableSnapshot, Scene, TextBox } from '../../dashboards/snapshots/scene.ts'
import { fail } from '../../query/types.ts'
import { NATIVE_REPORT_LIMITS, type NativeReportColumn, type NativeReportDefinition, type NativeReportRow } from './types.ts'

const PAGE_WIDTH = 612, PAGE_HEIGHT = 792, MARGIN = 36, WIDTH = PAGE_WIDTH - MARGIN * 2, SIZE = 13, LEADING = SIZE * 1.25, PADDING = 4
// Helvetica advances for printable ASCII; extended supported glyphs use a safe upper bound.
const advances = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
const extra = new Set(['€', '–', '—', '‘', '’', '“', '”', '…'])
function advance(character: string, size: number): number {
 const code = character.codePointAt(0)!
 if (!(code >= 32 && code <= 126 || code >= 160 && code <= 255 || extra.has(character))) fail('native_report_pdf_character_unsupported')
 return (code <= 126 ? advances[code - 32] : 1015) * size / 1000
}
const width = (text: string, size = SIZE) => [...text].reduce((total, character) => total + advance(character, size), 0)

/** Wrap using font advances, including long unbroken cells, without losing text. */
function wrap(value: string, available: number, size = SIZE): string[] {
 const result: string[] = []
 for (const paragraph of value.split('\n')) {
  let line = '', used = 0
  for (const character of paragraph) {
   const next = advance(character, size)
   if (next > available) fail('native_report_column_width_unsupported')
   if (used + next > available) { result.push(line); line = ''; used = 0 }
   line += character; used += next
  }
  result.push(line)
 }
 return result
}
function box(shapes: Scene['shapes'], label: string, lines: string[], x: number, y: number, w: number, size = SIZE): number {
 const h = lines.length * size * 1.25
 shapes.push({kind: 'text', label, x, y, w, h, size, lines})
 return h
}
export type ReportSection = { label: string | null; rows: NativeReportRow[] }

export function paginateReport(definition: NativeReportDefinition, columns: NativeReportColumn[], sections: ReportSection[]): PrintableSnapshot['pages'] {
 const minimums = columns.map(column => Math.max(40, ...[...column.name].filter(c => c !== '\n').map(c => advance(c, SIZE) + PADDING * 2)))
 if (minimums.reduce((sum, n) => sum + n, 0) > WIDTH) fail('native_report_column_width_unsupported')
 const desired = columns.map((column, index) => Math.max(minimums[index], Math.min(180, Math.max(...[column.name, ...sections.flatMap(section => section.rows.map(row => row.cells[index].display))].flatMap(value => value.split('\n').map(line => width(line) + PADDING * 2))))))
 const minimum = minimums.reduce((sum, n) => sum + n, 0), wanted = desired.reduce((sum, n) => sum + n, 0)
 const factor = wanted <= WIDTH ? 1 : (WIDTH - minimum) / (wanted - minimum)
 const widths = desired.map((value, index) => minimums[index] + (value - minimums[index]) * factor)
 if (wanted < WIDTH) widths[0] += WIDTH - wanted
 const titleLines = wrap(definition.title, WIDTH, 18), headerLines = definition.header ? wrap(definition.header, WIDTH) : [], footerLines = definition.footer ? wrap(definition.footer, WIDTH) : []
 const footerTop = PAGE_HEIGHT - MARGIN - (footerLines.length + 1) * LEADING - 4
 const headings = columns.map((column, index) => wrap(column.name, widths[index] - PADDING * 2))
 const headingHeight = Math.max(...headings.map(lines => lines.length)) * LEADING + PADDING * 2
 const pages: Scene[] = []
 let scene: Scene | undefined, y = 0, activeLabel: string | null = null
 const newPage = (label: string | null) => {
  if (pages.length >= NATIVE_REPORT_LIMITS.pages) fail('native_report_page_limit')
  scene = {title: definition.title, tab: 'report', shapes: []}; pages.push(scene)
  y = MARGIN
  y += box(scene.shapes, 'Report title', titleLines, MARGIN, y, WIDTH, 18) + 8
  if (headerLines.length) y += box(scene.shapes, 'Report header', headerLines, MARGIN, y, WIDTH) + 8
  if (label !== null) y += box(scene.shapes, 'Report group', wrap(label, WIDTH), MARGIN, y, WIDTH) + 8
  let x = MARGIN
  for (const [index, lines] of headings.entries()) { box(scene.shapes, 'Table heading ' + columns[index].name, lines, x + PADDING, y + PADDING, widths[index] - PADDING * 2); x += widths[index] }
  y += headingHeight + 4
  if (footerTop - y < LEADING + PADDING * 2) fail('native_report_furniture_does_not_fit')
  if (footerLines.length) box(scene.shapes, 'Report footer', footerLines, MARGIN, footerTop + 4, WIDTH)
  box(scene.shapes, 'Page number', [''], MARGIN, PAGE_HEIGHT - MARGIN - LEADING, WIDTH)
  activeLabel = label
 }
 const rowLayout = (row: NativeReportRow) => {
  const lines = row.cells.map((cell, index) => wrap(cell.display, widths[index] - PADDING * 2))
  return {lines, height: Math.max(...lines.map(value => value.length)) * LEADING + PADDING * 2}
 }
 for (const section of sections) {
  const layouts = section.rows.map(rowLayout)
  if (!layouts.length) continue
  if (!scene || definition.pageBreakGroups && section.label !== null && activeLabel !== section.label) newPage(section.label)
  else if (section.label !== null && section.label !== activeLabel) {
   const lines = wrap(section.label, WIDTH), height = lines.length * LEADING + 8
   if (y + height + layouts[0].height > footerTop) newPage(section.label)
   else { y += box(scene!.shapes, 'Report group', lines, MARGIN, y, WIDTH) + 8; activeLabel = section.label }
  }
  for (const [index, row] of section.rows.entries()) {
   const layout = layouts[index]
   if (y + layout.height > footerTop) newPage(section.label)
   if (y + layout.height > footerTop) fail('native_report_row_does_not_fit')
   let x = MARGIN
   for (const [column, lines] of layout.lines.entries()) { box(scene!.shapes, row.kind + ' ' + columns[column].name, lines, x + PADDING, y + PADDING, widths[column] - PADDING * 2); x += widths[column] }
   y += layout.height
  }
 }
 if (!pages.length) newPage(null)
 for (const [index, page] of pages.entries()) {
  const number = page.shapes.find(shape => shape.label === 'Page number') as TextBox
  number.lines = ['Page ' + (index + 1) + ' of ' + pages.length]
  page.shapes.sort((a, b) => a.y - b.y || a.x - b.x)
 }
 return pages
}
