import { $, action, contentLink, element, request, table } from './catalog-shared.js'
export function startHygiene() {
 let report = null
 function render() {
  if (!report) return
  const mode = $('library-hygiene-filter').value, aggregates = new Map(report.aggregate.items.map(item => [item.id, item]))
  const selected = report.items.filter(item => mode === 'unused' ? item.unused && item.kind === 'dashboard' : mode === 'duplicates' ? item.duplicates.length : mode === 'stale' ? item.stale : mode === 'archived' ? !!item.archived : true)
  const list = element('ul', { class: 'library-list' })
  for (const item of selected) {
   const aggregate = aggregates.get(item.id)
   if (!aggregate || !['available','suppressed'].includes(aggregate.state)) throw Error('The library did not provide a current aggregate privacy decision for every item.')
   const use = aggregate.state === 'available' ? `${aggregate.opens} opens · last opened ${aggregate.lastOpen}` : 'Usage suppressed for this small reader group'
   const flags = [item.archived ? 'Archived' : '', item.unused ? 'Unused' : '', item.stale ? 'Stale' : '', item.duplicates.length ? 'Duplicate definition' : ''].filter(Boolean)
   const dependencies = report.dependencies.filter(dependency => dependency.depends_on === item.id)
   list.append(element('li', { class: 'library-row' }, element('div', {}, contentLink(item.id, item.title), element('p', { class: 'meta' }, flags.join(' · ')), element('p', { class: 'meta' }, use), element('details', {}, element('summary', {}, 'Ownership and dependencies'), element('p', {}, 'Owner account: ' + item.owner_id), element('p', {}, `${dependencies.length} registered dependents`), element('ul', {}, dependencies.map(dependency => element('li', {}, contentLink(dependency.item_id, report.items.find(candidate => candidate.id === dependency.item_id)?.title)))), item.duplicates.length ? element('p', {}, 'Same-definition items: ', item.duplicates.map((id, index) => element('span', {}, index ? ' · ' : '', contentLink(id, report.items.find(candidate => candidate.id === id)?.title)))) : null))))
  }
  $('library-hygiene-results').replaceChildren(selected.length ? list : element('p', { class: 'meta' }, 'No content matches this hygiene filter.'))
 }
 action($('library-hygiene-load'), async () => {
  const value = await request('/api/operator/library/hygiene')
  if (!value.aggregate || !Array.isArray(value.aggregate.items) || !Number.isSafeInteger(value.aggregate.minimumGroupSize) || value.aggregate.minimumGroupSize < 2) throw Error('Aggregate privacy decisions are unavailable. No raw usage counts were substituted.')
  report = value
  $('library-hygiene-denominator').replaceChildren(element('p', {}, `${value.denominator.items} content items · ${value.denominator.archivedItems} archived`), element('p', { class: 'meta' }, `Aggregate usage requires at least ${value.aggregate.minimumGroupSize} distinct readers per item.`))
  $('library-usage-detail').replaceChildren(element('p', {}, `Historical-open denominator: ${value.denominator.historicalOpens}. Archiving does not change it.`), value.usage.length ? table('Owner-only reader and tenant usage', ['Content', 'Reader ID', 'Tenant', 'Opens', 'Last opened'], value.usage.map(use => [contentLink(use.item_id, value.items.find(item => item.id === use.item_id)?.title), use.reader_id, use.tenant, use.opens, use.lastOpen])) : element('p', {}, 'No retained usage events in this 90-day window.'))
  render(); $('library-hygiene-report').hidden = false
 })
 $('library-hygiene-filter').addEventListener('change', render)
}
