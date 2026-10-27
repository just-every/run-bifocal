import { stamp } from './format.js'
export const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node }
export function table(caption, headers, rows, numeric) {
 const wrap = element('div', undefined, 'tablewrap'); wrap.tabIndex = 0; wrap.setAttribute('aria-label', `${caption}, scroll horizontally`)
 const node = element('table'), more = element('p', 'More columns →', 'more'); more.hidden = true; more.setAttribute('aria-hidden', 'true'); node.append(element('caption', caption))
 // Columns past the right edge are announced, never silently cut: a line pinned to the visible top right says so and the
 // edge fades until the end.
 const cue = () => { const wide = wrap.scrollWidth > wrap.clientWidth + 1; more.hidden = !wide; wrap.toggleAttribute('data-more', wide && wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1) }
 const watch = new ResizeObserver(cue); watch.observe(wrap); watch.observe(node); wrap.addEventListener('scroll', cue, { passive: true })
 // A column whose every value is a number reads right-aligned, its head too; a caller that formats its figures says which.
 const number = value => typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value)), numbers = numeric ?? headers.map((_, i) => rows.length > 0 && rows.every(values => values[i] === null || number(values[i])))
 const head = element('thead'), header = element('tr'); headers.forEach((name, i) => { const cell = element('th', name, numbers[i] ? 'num' : undefined); cell.scope = 'col'; header.append(cell) }); head.append(header); node.append(head)
 const body = element('tbody'); for (const values of rows) { const row = element('tr'); values.forEach((value, i) => row.append(element('td', value === null ? 'NULL' : value, numbers[i] ? 'num' : undefined))); body.append(row) }; node.append(body); wrap.append(more, node); return wrap
}
export function metadata(entries) {
 const list = element('dl', undefined, 'panel metadata')
 for (const [name, value] of entries) { const item = element('div', undefined, 'meta'); item.append(element('dt', name), element('dd', value ?? 'None')); list.append(item) }
 return list
}
export function sourceView(source, updatedAt, zone) {
 const entries = [['Filename', source.filename], ['SHA-256', source.sha256], ['Encoding', source.encoding], ['Delimiter', source.delimiter === '\t' ? 'Tab' : source.delimiter], ['Null marker', JSON.stringify(source.nullValue)], ['Formula treatment', source.formulaTreatment], ['Plan prepared', stamp(updatedAt, zone)]]
 if (source.sheet) entries.push(['Sheet', source.sheet], ['Available sheets', source.sheets.join(', ')])
 if (source.spreadsheet) entries.push(['Provider', source.spreadsheet.provider], ['Workbook', source.spreadsheet.workbook], ['Sheet', source.spreadsheet.sheet], ['Range', source.spreadsheet.range], ['Fetched', stamp(source.spreadsheet.fetchedAt, zone)])
 const container = element('div'); container.append(element('h3', 'Source lineage and interpretation'), metadata(entries))
 if(source.lineage){const line=source.lineage,link=element('a','Open source report or table');link.href=line.link;link.rel='noreferrer';container.append(metadata([['Source kind',line.kind],['Definition',line.description],['Window',line.from+' through '+line.to+' (end exclusive)'],['Reporting timezone',line.timezone],['Observed',stamp(line.observedAt,zone)],['Protocol',line.schema]]),link)}
 if (source.formulas?.length) container.append(table('Retained formulas (never evaluated)', ['Cell', 'Formula', 'Cached value'], source.formulas.map(row => [row.cell, row.formula, row.cached])))
 return container
}
