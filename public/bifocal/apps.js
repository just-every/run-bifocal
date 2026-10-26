import { $, element, request, status, action } from './catalog-shared.js'
import { upload } from './file-upload.js'
const api = path => '/api/operator/apps' + path
const messages = { exact_app_publication_review_required: 'The app changed since this review. Review it again.', app_publication_issues: 'Resolve the listed issues before publishing.', app_draft_revision_changed: 'The draft changed. Reload this page and review again.', membership_changed: 'This person’s membership changed. Reload and choose them again.' }
const call = async (path, method = 'GET', body) => {
 const response = await fetch(api(path), { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 const data = await response.json().catch(() => ({}))
 if (!response.ok) throw Error(messages[data.error] ?? 'The app was not changed' + (data.error ? ' (' + data.error + ')' : '') + '.')
 return data
}
const json = form => { try { return JSON.parse(form.elements.document.value) } catch { throw Error('Enter valid JSON for the app definition. Your edits are kept.') } }
const list = (items, empty) => items.length ? element('ul', { class: 'library-list' }, items.map(text => element('li', { class: 'library-row' }, element('div', {}, text)))) : element('p', { class: 'meta' }, empty)
function previewTable(preview) {
 return element('div', { class: 'tablewrap', tabindex: '0', 'aria-label': 'Audience page previews, scroll horizontally' }, element('table', {}, element('thead', {}, element('tr', {}, ['Audience', 'Page', 'Rows in scope'].map(name => element('th', { scope: 'col' }, name)))), element('tbody', {}, preview.map(row => element('tr', {}, element('td', {}, row.audience), element('td', {}, row.page), element('td', { class: 'num' }, row.filteredRows))))))
}
function confirmBox(box, review, label, perform) {
 const check = element('input', { type: 'checkbox', id: 'app-confirm' }), button = element('button', { type: 'button', class: 'primary', disabled: true }, label)
 check.addEventListener('change', () => { button.disabled = !check.checked || review.issues.length > 0 })
 button.addEventListener('click', async () => { button.disabled = true; try { await perform(); } catch (error) { status(error.message, true, 'status'); button.disabled = false } })
 box.append(element('label', { class: 'checkbox' }, check, 'I reviewed this exact version, its audiences and their row scope'), element('div', { class: 'actions' }, button))
}
function showReview(box, review, label, perform) {
 box.hidden = false; box.replaceChildren(
  element('p', { class: 'meta' }, 'Version ' + review.version + ' · fingerprint ' + review.reviewDigest.slice(0, 16)),
  review.issues.length ? element('div', { role: 'alert', class: 'warning' }, element('p', {}, 'Issues to resolve:'), list(review.issues.map(issue => (issue.audience ? issue.audience + ' · ' : '') + issue.page + ': ' + issue.error), '')) : element('p', { class: 'meta' }, 'No issues found.'),
  ...(review.changes ? [element('p', { class: 'meta' }, ['pagesAdded', 'pagesRemoved', 'audiencesAdded', 'audiencesRemoved'].map(name => name.replace(/([A-Z])/g, ' $1').toLowerCase() + ': ' + (review.changes[name].join(', ') || 'none')).join(' · '))] : []),
  element('p', { class: 'meta' }, 'Summary reading only · expires ' + review.document.expiresAt + ' · readers ' + (review.members?.map(m => m.email + ' in ' + m.audience).join(', ') || 'none')), previewTable(review.preview))
 confirmBox(box, review, label, perform)
}
const owner = $('app-owner')
if ($('app-create')) action($('app-create'), async () => { const created = await call('', 'POST', { document: json($('app-create')) }); location.assign('/app/apps/' + created.id) })
if (owner) {
 const id = owner.dataset.app, draftRevision = Number(owner.dataset.draftRevision), published = Number(owner.dataset.published) || null
 action($('app-draft'), async () => { await call('/' + id + '/draft', 'POST', { previousRevision: draftRevision, document: json($('app-draft')) }); location.reload() })
 for (const form of document.querySelectorAll('.app-member-form')) action(form, async () => {
  const option = form.elements.person.selectedOptions[0]
  await call('/' + id + '/members', 'PUT', { audience: form.dataset.audience, operatorId: option.value, operatorVersion: Number(option.dataset.version), enabled: true }); location.reload()
 })
 for (const button of document.querySelectorAll('[data-remove]')) action(button, async () => { await call('/' + id + '/members', 'PUT', { audience: button.dataset.audience, operatorId: button.dataset.remove, operatorVersion: Number(button.dataset.version), enabled: false }); location.reload() })
 action($('app-review'), async () => {
  const review = await call('/' + id + '/publication/review', 'POST', { draftRevision })
  showReview($('app-review-result'), review, 'Publish version ' + review.version, async () => { await call('/' + id + '/publication/publish', 'POST', { draftRevision, reviewedDigest: review.reviewDigest }); location.reload() })
 })
 for (const button of document.querySelectorAll('[data-restore]')) action(button, async () => {
  const review = await call('/' + id + '/rollback/review', 'POST', { version: Number(button.dataset.restore), previousPublished: published })
  showReview($('app-restore-result'), review, 'Restore version ' + review.restores + ' as version ' + review.version, async () => { await call('/' + id + '/rollback/apply', 'POST', { version: review.restores, previousPublished: published, reviewedDigest: review.reviewDigest }); location.reload() })
 })
}
const subscription = $('app-subscription')
if (subscription) {
 const base = '/' + subscription.dataset.app + '/subscriptions'
 if ($('app-subscribe')) action($('app-subscribe'), async () => { await call(base, 'POST', { audience: subscription.dataset.audience, pageKey: subscription.dataset.page }); location.reload() })
 if ($('app-unsubscribe')) action($('app-unsubscribe'), async () => { await fetch(api(base + '/' + subscription.dataset.subscription), { method: 'DELETE', credentials: 'same-origin' }); location.reload() })
 if ($('app-preview')) action($('app-preview'), async () => {
  const preview = await call(base + '/' + subscription.dataset.subscription + '/preview', 'POST', {}), box = $('app-preview-result')
  box.hidden = false; box.replaceChildren(element('p', { class: 'meta' }, 'Next delivery preview: ' + preview.content.cards.length + ' ' + (preview.content.cards.length === 1 ? 'card' : 'cards') + '. Nothing was sent; the dispatcher is unavailable.'))
 })
}
const form = $('app-import')
if (form) {
 const door = async (action, data, project) => {
  const response = await fetch('/api/operator/import/' + action, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-Import-Kind': 'power-bi-app', 'X-Import-Dataset': project }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
  const body = await response.json(); if (!response.ok) throw Error('The import was refused (' + body.error + ').'); return body
 }
 const box = $('app-import-review'); let plan = null, project = null
 const reviewMapping = async () => {
  const current = await request('/api/operator/app-imports/' + project)
  box.replaceChildren(element('h3', {}, 'Map content and people'), element('p', { class: 'hint' }, 'Enter the Bifocal content ID for each Power BI item. People match only active members; groups and unmatched people stay unmapped. Nothing is activated until you publish.'))
  const mapping = element('form', { id: 'app-mapping' }, element('label', {}, 'Access expires at (UTC)', element('input', { name: 'expiresAt', required: true, value: new Date(Date.now() + 86400000).toISOString() })), current.content.map(item => element('div', { class: 'fields' }, element('label', {}, item.name + ' (' + item.type + ') Bifocal content ID', element('input', { name: 'content:' + item.id })), element('label', {}, 'Content kind for ' + item.name, element('select', { name: 'kind:' + item.id, 'aria-label': 'Content kind for ' + item.name }, ['dashboard', 'report', 'question'].map(kind => element('option', { selected: kind === item.type }, kind)))))),
  [...new Map(current.audiences.flatMap(a => (a.rowRole?.sourceRules || []).map(rule => [rule.table + '.' + rule.column, rule]))).values()].map(rule => element('label', {}, 'Bifocal column for ' + rule.table + '.' + rule.column, element('input', { name: 'column:' + rule.table + '.' + rule.column, required: true }))),
  current.audiences.flatMap(a => a.members.map(m => element('label', { class: 'checkbox' }, element('input', { type: 'checkbox', name: 'person:' + a.key + ':' + m.identifier, disabled: !m.candidate, checked: !!m.candidate, 'data-audience': a.key }), a.name + ': ' + m.identifier + (m.candidate ? ' maps to ' + m.candidate.email : ' is unmapped (' + m.issue + ')')))),
  element('div', { class: 'actions' }, element('button', { type: 'submit', class: 'primary' }, 'Review mapping')))
  const result = element('div', { id: 'app-mapping-result' }); box.append(mapping, result)
  action(mapping, async () => {
   const values = new FormData(mapping), contentMappings = {}, identityMappings = {}, columnMappings = {}
   for (const item of current.content) if (String(values.get('content:' + item.id)).trim()) contentMappings[item.id] = { kind: values.get('kind:' + item.id), ref: String(values.get('content:' + item.id)).trim() }
   for (const a of current.audiences) for (const m of a.members) if (m.candidate && values.get('person:' + a.key + ':' + m.identifier) === 'on') identityMappings[a.key + ':' + m.identifier] = { operatorId: m.candidate.operatorId, operatorVersion: m.candidate.operatorVersion }
   for (const a of current.audiences) for (const rule of a.rowRole?.sourceRules || []) columnMappings[rule.table + '.' + rule.column] = String(values.get('column:' + rule.table + '.' + rule.column)).trim()
   const input = { columnMappings, previousRevision: current.revision, contentMappings, identityMappings, expiresAt: String(values.get('expiresAt')) }, review = await call('/imports/' + project + '/review', 'POST', input)
   result.replaceChildren(element('p', { class: 'meta' }, 'Draft fingerprint ' + review.digest.slice(0, 16) + ' · audiences ' + review.document.audiences.map(a => a.name).join(', ') + ' · mapped readers ' + review.members.length + ' · unmapped content ' + (review.unmappedContent.join(', ') || 'none') + ' · unresolved people ' + (review.unresolvedPrincipals.join(', ') || 'none')))
   const check = element('input', { type: 'checkbox' }), create = element('button', { type: 'button', class: 'primary', disabled: true }, 'Create draft app')
   check.addEventListener('change', () => { create.disabled = !check.checked })
   create.addEventListener('click', async () => { create.disabled = true; try { const created = await call('/imports/' + project + '/create', 'POST', { ...input, reviewedDigest: review.digest }); location.assign('/app/apps/' + created.id) } catch (error) { status(error.message, true, 'status'); create.disabled = false } })
   result.append(element('label', { class: 'checkbox' }, check, 'I reviewed this exact draft and its identity mappings'), element('div', { class: 'actions' }, create))
  })
 }
 action(form, async () => {
  project = form.elements.project.value; const text = await form.elements.file.files[0].text()
  let input; try { input = JSON.parse(text) } catch { throw Error('The export is not valid JSON.') }
  const call2 = (name, data, id) => door(name, data, id), uploadId = await upload(input, call2, text => status(text, false, 'status'), project)
  const history = await door('history', undefined, project)
  plan = await door('plan', { uploadId, ...(history.history.length ? { catchup: true } : {}) }, project)
  const summary = plan.project
  box.hidden = false; box.replaceChildren(element('h3', {}, 'Import review'), element('p', { class: 'meta' }, summary ? summary.source.name + ' · ' + summary.audiences.length + ' audiences · ' + summary.content.length + ' content items · ' + summary.issues.length + ' unresolved items' : 'The export could not be read. Inspect the plan errors.'), summary ? list(summary.issues, 'No unresolved items.') : element('span'))
  const check = element('input', { type: 'checkbox' }), apply = element('button', { type: 'button', class: 'primary', disabled: true }, 'Apply import')
  check.addEventListener('change', () => { apply.disabled = !check.checked || !summary || !!plan.counts.rejected })
  apply.addEventListener('click', async () => {
   apply.disabled = true
   try { for (let i = 0; i < 20; i++) { const result = await door('apply', { planId: plan.planId, reviewedFingerprint: plan.fingerprint }, project); if (result.job.state === 'completed') { await door('reconcile', { planId: plan.planId }, project); await reviewMapping(); status('Import reconciled. Review the mappings below.', false, 'status'); return } } } catch (error) { status(error.message, true, 'status'); apply.disabled = false }
  })
  box.append(element('label', { class: 'checkbox' }, check, 'I reviewed this exact plan and its fingerprint'), element('div', { class: 'actions' }, apply))
 })
}

const dashboard = $('app-dashboard')
if (dashboard) {
 const endpoint = '/' + dashboard.dataset.app + '/audiences/' + dashboard.dataset.audience + '/pages/' + dashboard.dataset.page + '/dashboard'
 try {
  const resource = await call(endpoint + '/resource'), { mountDashboardReader } = await import('./dashboard-reader.js')
  await mountDashboardReader({ root: dashboard, resource, api: (path, data) => call(path, data === undefined ? 'GET' : 'POST', data), status: (text, error = false) => status(text, error, 'status'), zone: 'UTC', endpoint, allowExports: false, allowDuplicate: false })
 } catch (error) { status(error.message, true, 'status') }
}
