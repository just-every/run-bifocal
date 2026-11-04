const form = document.querySelector('#bigquery-catalog-form')
if (form) {
 const project = form.elements.project, dataset = form.elements.dataset, table = form.elements.table
 const status = document.querySelector('#bigquery-catalog-status'), results = document.querySelector('#bigquery-catalog-results'), objects = document.querySelector('#bigquery-catalog-objects')
 const previous = document.querySelector('#bigquery-catalog-previous'), next = document.querySelector('#bigquery-catalog-next'), pageLabel = document.querySelector('#bigquery-catalog-page')
 let generation = 0, pending = false, current = null, page = 0, controller
 const buttons = [...form.querySelectorAll('button')]
 const enable = () => { buttons.forEach(button => { button.disabled = pending || (button.value === 'tables' && !dataset.value) || (button.value === 'schema' && !table.value) }) }
 const resetSelect = (element, text) => { element.replaceChildren(new Option(text, '')); element.disabled = true }
 const clearResults = () => { current = null; page = 0; results.hidden = true; objects.replaceChildren(); previous.disabled = next.disabled = true }
 const invalidate = level => {
  generation++; controller?.abort(); pending = false; clearResults(); status.textContent = ''
  form.elements.accessToken.value = ''; form.elements.consent.checked = false
  if (level === 'project') resetSelect(dataset, 'Browse datasets first')
  if (level !== 'table') resetSelect(table, 'Browse tables first')
  enable()
 }
 project.addEventListener('input', () => invalidate('project'))
 dataset.addEventListener('change', () => invalidate('dataset'))
 table.addEventListener('change', () => invalidate('table'))
 const showPage = () => {
  objects.replaceChildren()
  const rows = current.pages ? current.pages[page] : current.fields
  const grid = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody'), header = document.createElement('tr')
  for (const label of current.pages ? ['Object','Location or type','Diagnostic'] : ['Field','Type','Mode','Bounded read']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.append(th) }
  head.append(header); grid.append(head,body)
  for (const row of rows) {
   const tr = document.createElement('tr')
   for (const value of current.pages ? [row.id,row.location ?? row.type,row.diagnostic ?? 'Available for inspection'] : [row.path,row.type,row.mode,row.diagnostic ?? 'Supported scalar']) { const td = document.createElement('td'); td.textContent = value; td.style.overflowWrap = 'anywhere'; tr.append(td) }
   body.append(tr)
  }
  if (!rows.length) { const text = document.createElement('p'); text.textContent = 'No visible objects. Check the project and provider permissions; an empty list does not prove the project has no objects.'; objects.append(text) }
  const region = document.createElement('div'); region.className = 'bigquery-metadata-table'; region.tabIndex = 0; region.setAttribute('role','region'); region.setAttribute('aria-label','BigQuery metadata table'); region.append(grid); objects.append(region)
  pageLabel.textContent = current.pages ? `Metadata page ${page + 1} of ${current.pages.length}; ${current.count} visible objects` : `${rows.length} inspected fields. ${current.diagnostic ?? ''}`
  previous.disabled = !current.pages || page === 0; next.disabled = !current.pages || page + 1 === current.pages.length
 }
 previous.addEventListener('click', () => { page--; showPage() }); next.addEventListener('click', () => { page++; showPage() })
 const messages = {
  provider_grant_refused:'Google refused this metadata operation. Check that the token is current and has dataset visibility, table listing and table metadata permissions for the selected object.',
  bigquery_object_not_found:'The selected BigQuery object is missing or inaccessible. Check its identifiers and your provider permissions, then browse again.',
  provider_rate_limited:'Google rate limited metadata browsing. No automatic retry was made; wait before consenting again.',
  provider_redirect_refused:'Google returned a redirect. It was refused and your token was not forwarded.',
  bigquery_us_location_required:'This object is outside the supported US location.',
  bigquery_catalog_page_limit:'The catalog exceeds the bounded five-page listing. No partial selection was accepted.',
  bigquery_repeated_or_invalid_cursor:'Google returned a repeated or invalid cursor. The incomplete listing was refused.',
  bigquery_schema_limit:'The schema exceeds 250 fields or eight nested levels. No partial schema was accepted.',
  bigquery_schema_unavailable:'Google did not supply a schema for this object. Check metadata access and the object type.',
  bigquery_table_type_unsupported:'This object type cannot be inspected by the supported BigQuery metadata reader.',
  bigquery_location_unavailable:'Google did not supply a supported location. US location must be established before table selection.',
  owner_required:'Your current native owner session is required. Sign in again before browsing.',
 }
 form.addEventListener('submit', async event => {
  event.preventDefault(); if (pending) return
  const action = event.submitter?.value
  if (!['datasets','tables','schema'].includes(action)) return
  const input = {action,project:project.value,accessToken:form.elements.accessToken.value,confirmBrowse:form.elements.consent.checked,...(action !== 'datasets' ? {dataset:dataset.value} : {}),...(action === 'schema' ? {table:table.value} : {})}
  const version = ++generation
  controller?.abort(); controller = new AbortController(); pending = true; enable(); clearResults()
  // The token is cleared before sending and is never placed in storage or a URL.
  form.elements.accessToken.value = ''; form.elements.consent.checked = false
  if (action === 'datasets') resetSelect(dataset, 'Choose a US dataset')
  if (action !== 'schema') resetSelect(table, 'Browse tables first')
  status.textContent = 'Reading bounded metadata…'
  try {
   const response = await fetch('/api/operator/analytics/bigquery/catalog', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),cache:'no-store',redirect:'error',signal:controller.signal})
   const result = await response.json()
   if (version !== generation) return
   if (!response.ok) throw Error(messages[result.error] ?? `Metadata operation refused (${result.error ?? response.status}). Check the selected object and supported bounds.`)
   current = result; page = 0
   if (result.pages) {
    const select = action === 'datasets' ? dataset : table
    for (const row of result.pages.flat()) { const option = new Option(row.id + (row.selectable ? '' : ' — ' + row.diagnostic),row.id); option.disabled = !row.selectable; select.append(option) }
    select.disabled = !result.pages.flat().some(row => row.selectable)
   }
   document.querySelector('#bigquery-catalog-observed').textContent = `Observed metadata at ${result.observedAt} for ${result.project}${result.dataset ? '.' + result.dataset : ''}${result.table ? '.' + result.table : ''}. Source freshness remains unknown. Schema success proves no data freshness, execution or provider authorization beyond this operation.`
   showPage(); results.hidden = false; status.textContent = 'Metadata inspected. Supply a token and consent again for the next action.'
  } catch (error) { if (version === generation) { clearResults(); status.textContent = error.name === 'AbortError' ? 'Selection changed; browse again.' : error.message } }
  finally { input.accessToken = ''; if (version === generation) { pending = false; enable() } }
 })
}
