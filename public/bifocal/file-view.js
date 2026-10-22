export const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node }
export function table(caption, headers, rows) {
 const wrap = element('div', undefined, 'tablewrap'); wrap.tabIndex = 0; wrap.setAttribute('aria-label', `${caption}, scroll horizontally`)
 const node = element('table'); node.append(element('caption', caption))
 // A column whose every value is a number reads right-aligned, its head too.
 const numeric = value => typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value)), numbers = headers.map((_, i) => rows.length > 0 && rows.every(values => values[i] === null || numeric(values[i])))
 const head = element('thead'), header = element('tr'); headers.forEach((name, i) => { const cell = element('th', name, numbers[i] ? 'num' : undefined); cell.scope = 'col'; header.append(cell) }); head.append(header); node.append(head)
 const body = element('tbody'); for (const values of rows) { const row = element('tr'); values.forEach((value, i) => row.append(element('td', value === null ? 'NULL' : value, numbers[i] ? 'num' : undefined))); body.append(row) }; node.append(body); wrap.append(node); return wrap
}
export function metadata(entries) {
 const list = element('dl', undefined, 'panel metadata')
 for (const [name, value] of entries) { const item = element('div', undefined, 'meta'); item.append(element('dt', name), element('dd', value ?? 'None')); list.append(item) }
 return list
}
export function sourceView(source, updatedAt) {
 const entries = [['Filename', source.filename], ['SHA-256', source.sha256], ['Encoding', source.encoding], ['Delimiter', source.delimiter === '\t' ? 'Tab' : source.delimiter], ['Null marker', JSON.stringify(source.nullValue)], ['Formula treatment', source.formulaTreatment], ['Plan prepared', updatedAt]]
 if (source.sheet) entries.push(['Sheet', source.sheet], ['Available sheets', source.sheets.join(', ')])
 if (source.spreadsheet) entries.push(['Provider', source.spreadsheet.provider], ['Workbook', source.spreadsheet.workbook], ['Sheet', source.spreadsheet.sheet], ['Range', source.spreadsheet.range], ['Fetched', source.spreadsheet.fetchedAt])
 const container = element('div'); container.append(element('h3', 'Source lineage and interpretation'), metadata(entries))
 if (source.formulas?.length) container.append(table('Retained formulas (never evaluated)', ['Cell', 'Formula', 'Cached value'], source.formulas.map(row => [row.cell, row.formula, row.cached])))
 return container
}
