import { $, action, element, itemUrl, metadata, people, readers, request, status } from './catalog-shared.js'
import { startHygiene } from './catalog-hygiene.js'
export async function startSettings() {
 const privacy = $('library-privacy-form'); let usage = null
 $('library-collections').after(element('p', { id: 'library-collection-status', class: 'status', role: 'status', 'aria-live': 'polite' }))
 const clearUsage = () => { usage = null; $('library-usage-preview').hidden = true; $('library-usage-approve').checked = false; $('library-usage-import').disabled = true }
 action(privacy, async () => {
  if (!$('library-privacy-consent').checked) throw Error('Approve the named privacy disclosure before changing collection.')
  const result = await request('/api/operator/library/privacy', 'PUT', { previousVersion: Number(privacy.dataset.version), disclosureVersion: Number(privacy.dataset.disclosureVersion), usageEnabled: $('library-usage-enabled').checked, consent: true, detail: 'owner-only' })
  privacy.dataset.version = String(result.version); privacy.dataset.usageEnabled = String(result.usageEnabled); $('library-privacy-consent').checked = false; clearUsage()
  status(`Usage ${result.usageEnabled ? 'enabled' : 'disabled'} · policy version ${result.version}`, false, 'library-privacy-status')
 })
 privacy.addEventListener('change', clearUsage)
 $('library-usage-file').addEventListener('change', clearUsage)
 action($('library-usage-form'), async () => {
  clearUsage()
  if (privacy.dataset.usageEnabled !== 'true') throw Error('Usage is disabled. Review the privacy disclosure and consent before importing events.')
  const file = $('library-usage-file').files[0]
  if (!file || file.size > 262144) throw Error('Choose a usage JSON file up to 256 KiB.')
  let parsed; try { parsed = JSON.parse(await file.text()) } catch { throw Error('The selected file is not valid JSON. Its contents were not imported.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(key => key !== 'events') || !Array.isArray(parsed.events) || parsed.events.length > 200 || !parsed.events.length) throw Error('The usage file must contain only an events array of 1 to 200 events.')
  for (const event of parsed.events) if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).length !== 5 || ['id','itemId','readerId','tenant','openedAt'].some(key => typeof event[key] !== 'string')) throw Error('Every event must contain string id, itemId, readerId, tenant and openedAt fields.')
  usage = { events: parsed.events, policyVersion: Number(privacy.dataset.version) }
  $('library-usage-summary').replaceChildren(element('h2', {}, 'Review authorized usage'), element('p', {}, `${file.name} · ${usage.events.length} events · policy version ${usage.policyVersion}`))
  $('library-usage-events').textContent = JSON.stringify(usage.events, null, 2); $('library-usage-preview').hidden = false
 })
 $('library-usage-approve').addEventListener('change', () => { $('library-usage-import').disabled = !usage || !$('library-usage-approve').checked })
 $('library-usage-import').addEventListener('click', async () => {
  const approved = usage; if (!approved || !$('library-usage-approve').checked) return
  $('library-usage-import').disabled = true
  try { const receipt = await request('/api/operator/library/usage/import', 'POST', approved); clearUsage(); status(`${receipt.accepted} reviewed usage events accepted under policy version ${receipt.policyVersion}.`, false, 'library-usage-status') }
  catch (error) { clearUsage(); status(error.message, true) }
 })
 startHygiene()
 action($('library-create'), async () => { const result = await request('/api/operator/library/items', 'POST', metadata($('library-create'))); window.location.assign(itemUrl(result.id)) })
 action($('library-collection-form'), async event => {
  const form = event.currentTarget, values = new FormData(form), created = await request('/api/operator/library/collections', 'POST', { name: values.get('name'), parentId: values.get('parentId') || null })
  $('library-collections').append(element('li', {}, created.name))
  for (const select of document.querySelectorAll('select[name="collectionId"],#library-collection-parent')) select.append(element('option', { value: created.id }, created.name))
  form.reset(); status('Collection created.', false, 'library-collection-status')
 })
 action($('library-collection-grant'), async event => {
  const values = new FormData(event.currentTarget)
  if (!values.get('collectionId') || !values.get('readerId') || !values.get('enabled')) throw Error('Choose a collection, active reader and access change.')
  await request('/api/operator/library/collections/' + encodeURIComponent(values.get('collectionId')) + '/grants', 'PUT', { readerId: values.get('readerId'), enabled: values.get('enabled') === 'true' })
  status('Collection access changed.', false, 'library-collection-status')
 })
 const operators = await people(); readers($('library-collection-reader'), operators)
}
