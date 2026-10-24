import { $, action, apiItem, contentLink, element, json, metadata, people, readers, request, sourceLinks, status, table } from './catalog-shared.js'
export function startItem(initial) {
 let item = initial, review = null, writing = false, pending = false
 const path = apiItem(item.id), owner = document.body.dataset.catalogRole === 'owner'
 function invalidate() { review = null; if ($('library-archive-review')) { $('library-archive-review').hidden = true; $('library-archive-approve').checked = false; $('library-archive-confirm').disabled = true } }
 function render() {
  $('library-item-title').textContent = item.title; $('library-item-description').textContent = item.description; $('library-item-kind').textContent = item.kind; $('library-item-version').textContent = item.version
  $('library-item-badge').hidden = !item.verified; $('library-item-badge').textContent = item.kind === 'metric' ? 'Certified metric' : 'Verified'
  $('library-item-tags').textContent = item.tags.join(' · '); if ($('library-definition')) $('library-definition').textContent = JSON.stringify(item.definition, null, 2); $('library-source-links').replaceChildren(sourceLinks(item)); $('library-archived-state').hidden = !item.archived
  $('library-favourite').textContent = item.favourite ? 'Remove favourite' : 'Add to favourites'; $('library-favourite').setAttribute('aria-pressed', String(!!item.favourite))
  if (owner) { $('library-metadata-fields').disabled = item.archived; $('library-archive-preview').textContent = item.archived ? 'Review restore' : 'Review archive' }
 }
 action($('library-favourite'), async () => { const value = await request(path + '/favourite', 'PUT', { favourite: !item.favourite }); item.favourite = value.favourite; render() })
 if (!owner) return
 async function save() {
  invalidate()
  if (writing) { pending = true; return }
  writing = true; status('Saving…', false, 'library-metadata-status')
  try {
   const value = metadata($('library-metadata')), result = await request(path, 'PUT', { ...value, previousVersion: item.version })
   item = { ...item, ...value, version: result.version }; render(); status('Saved', false, 'library-metadata-status')
  } catch (error) { pending = false; status(error.message, true, 'library-metadata-status') }
  finally { writing = false; if (pending) { pending = false; void save() } }
 }
 $('library-metadata').addEventListener('submit', event => event.preventDefault())
 $('library-metadata').addEventListener('change', () => { void save() })
 $('library-metadata').addEventListener('input', invalidate)
 action($('library-archive-preview'), async () => {
  if (writing || pending) throw Error('Wait for metadata changes to finish before reviewing archive or restore.')
  invalidate(); review = await request(path + '/archive-preview', 'POST', {})
  if (review.itemId !== item.id || review.version !== item.version || review.archived !== item.archived) { invalidate(); throw Error('This content changed. Reload the item before reviewing it.') }
  const operation = review.operation === 'restore' ? 'Restore' : 'Archive'
  $('library-archive-summary').replaceChildren(element('h2', {}, operation + ' this exact version'), element('p', {}, `${item.title} · version ${review.version} · owner ${review.ownerId}`), element('p', {}, 'This is reversible. Historical use, favourites, links and retained versions are preserved.'), element('details', {}, element('summary', {}, 'Owner-only historical usage'), json(review.historicalUsage)))
  $('library-archive-dependencies').replaceChildren(review.dependents.length ? table('Current dependent content', ['Content', 'Owner account', 'Version', 'Discovery'], review.dependents.map(d => [contentLink(d.id, d.title), d.owner_id, d.version, d.archived ? 'Archived' : 'Discoverable'])) : element('p', {}, 'No current dependent content is registered.'))
  $('library-review-digest').textContent = review.digest; $('library-archive-confirm').textContent = operation + ' reviewed content'; $('library-archive-review').hidden = false
 })
 $('library-archive-approve').addEventListener('change', () => { $('library-archive-confirm').disabled = !review || !$('library-archive-approve').checked })
 $('library-archive-confirm').addEventListener('click', async () => {
  const approved = review; if (!approved || !$('library-archive-approve').checked) return
  $('library-archive-confirm').disabled = true
  try { const value = await request(path + '/' + approved.operation, 'POST', { digest: approved.digest, previousVersion: approved.version }); item.archived = value.archived; item.version = value.version; invalidate(); render(); status(item.archived ? 'Content archived. Its retained link remains available to current grantees.' : 'Content restored. Current grants still control access.') }
  catch (error) { invalidate(); status(error.message, true) }
 })
 action($('library-versions-load'), async () => { const value = await request(path + '/versions'); $('library-versions').replaceChildren(...value.versions.map(version => element('details', {}, element('summary', {}, 'Version ' + version.version), json(JSON.parse(version.metadata_json))))) })
 async function loadGrants() {
  const [value, operators] = await Promise.all([request(path + '/grants'), people()])
  readers($('library-reader'), operators)
  $('library-grants').replaceChildren(element('p', {}, value.restore), value.grants.length ? table('Current catalog reader grants', ['Reader', 'Activation', 'Action'], value.grants.map(grant => {
   const person = operators.find(p => p.id === grant.readerId), label = person ? `${person.displayName} · ${person.email}` : grant.readerId
   const button = element('button', { type: 'button', ...(person?.status !== 'active' && !grant.active ? { disabled: true } : {}) }, grant.active ? 'Revoke' : 'Activate current grant')
   action(button, async () => { await request(path + '/grants', 'PUT', { readerId: grant.readerId, enabled: !grant.active }); invalidate(); await loadGrants() })
   return [label, grant.active ? 'Active' : 'Inactive · fresh owner activation required', button]
  })) : element('p', {}, 'No item reader grants are registered.'))
 }
 action($('library-grants-load'), loadGrants)
 action($('library-grant-form'), async event => { const values = new FormData(event.currentTarget); if (!values.get('readerId') || !values.get('enabled')) throw Error('Choose an active reader and an access change.'); await request(path + '/grants', 'PUT', { readerId: values.get('readerId'), enabled: values.get('enabled') === 'true' }); invalidate(); await loadGrants() })
}
