import { expressionText,exactText } from './calculation-format.js'
import { upload } from './file-upload.js'
import { element, metadata, table } from './file-view.js'

const $ = id => document.getElementById(id)
const text = value => value === undefined ? 'Not supplied' : value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)
let views = [], reviewed = null, saved = null, migration = null, imported = null, busy = false
const status = (message, error = false) => { $('status').textContent = message; $('status').dataset.error = String(error) }
const selectedView = () => {
 const view = views[Number($('view').value)]
 if (!view || $('view').value === '') throw Error('Choose a published governed view first.')
 return view
}
async function request(path, data, headers = {}) {
 const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
 const result = await response.json()
 if (!response.ok) throw Error(text(result.reason ?? result.error ?? 'Calculation request failed.').replaceAll('_', ' '))
 return result
}
const api = (path = '', data) => request('/api/operator/calculations' + path, data)
const importCall = (action, data, binding) => request('/api/operator/import/' + action, data, { 'X-Import-Kind': 'calculation', 'X-Import-Dataset': binding.id, 'X-Calculation-Model': binding.modelId, 'X-Calculation-View': binding.viewId })
async function act(work) {
 if (busy) return
 busy = true; $('workspace').inert = true; $('workspace').setAttribute('aria-busy', 'true'); status('Working…')
 try { await work() } catch (error) { status(error.message, true) }
 finally { busy = false; $('workspace').inert = false; $('workspace').removeAttribute('aria-busy'); controls() }
}
function controls() {
 $('approve').disabled = !reviewed?.report.compatible
 $('save').disabled = !reviewed?.report.compatible || !$('approve').checked
 $('migration-apply').disabled = !migration || migration.stale || !!migration.plan.counts.rejected || !$('migration-approve').checked
}
function invalidate() {
 reviewed = null; saved = null; $('approve').checked = false; $('review-panel').hidden = true; $('run-panel').hidden = true; $('run-results').hidden = true; controls()
}
function staleMigration() {
 if (migration) migration.stale = true
 $('migration-approve').checked = false; controls()
}
function parseDocument() {
 let input
 try { input = JSON.parse($('document').value) } catch { throw Error('Library definition must be valid JSON.') }
 if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.calculations)) throw Error('Library definition must contain a calculations array.')
 if (input.calculations.some(item => !item || typeof item.id !== 'string' || typeof item.language !== 'string' || typeof item.sourceExpression !== 'string')) throw Error('Every calculation requires an id, language and sourceExpression.')
 return input
}
function bind(input) {
 const view = selectedView()
 return { ...input, version: 1, modelId: view.modelId, modelRevision: view.revision, viewId: view.viewId }
}
function input() {
 if (!$('library-id').reportValidity() || !$('label').reportValidity()) throw Error('Enter a valid library id and name.')
 return bind({ ...parseDocument(), id: $('library-id').value, label: $('label').value })
}
function write(input) { $('document').value = JSON.stringify(input, null, 2); renderCalculations(input.calculations) }
function formulaKind() {
 const field = $('calculation-kind').value === 'field'
 $('field-type-label').hidden = !field; $('field-type').disabled = !field; $('formula').placeholder = field ? '[revenue] * 2' : 'SUM([revenue])'
}
function clearFormula() { $('formula-form').reset(); formulaKind(); $('calculation-id').focus() }
function showView() {
 const view = selectedView(), box = $('view-context'); box.replaceChildren()
 box.append(metadata([['Model', view.modelId], ['Revision', view.revision], ['View', view.viewId], ['Fiscal context', text(view.fiscal)], ['Immutable source filters', text(view.sourceFilters)], ['Immutable row rules', text(view.rowRules)], ['Declared hierarchies', text(view.hierarchies)]]))
 box.append(table('Available governed fields', ['Field', 'Type'], view.fields.map(field => [field.id, field.type])))
 box.append(table('Model measures', ['Measure', 'Governed definition'], view.measures.map(measure => [measure.id, text(measure)])))
}
function renderCalculations(calculations) {
 const box = $('calculation-list'); box.replaceChildren()
 if (!calculations.length) { box.append(element('p', 'No calculations yet. Write a formula to begin.')); return }
 const rows = calculations.map(calculation => [calculation.id, calculation.kind === 'field' ? 'Field · ' + calculation.dataType : 'Measure', calculation.language, calculation.sourceExpression, calculation.format ?? 'Default'])
 box.append(table('Library formulas', ['Calculation', 'Kind', 'Language', 'Source formula', 'Format'], rows))
 const actions = element('div', undefined, 'actions')
 calculations.forEach(calculation => {
  const edit = element('button', 'Edit ' + calculation.id); edit.type = 'button'
  edit.onclick = () => { $('calculation-id').value = calculation.id; $('language').value = calculation.language; $('calculation-kind').value = calculation.kind === 'field' ? 'field' : 'measure'; $('field-type').value = calculation.dataType ?? 'number'; formulaKind(); $('formula').value = calculation.language === 'native' ? JSON.stringify(calculation.expression, null, 2) : calculation.sourceExpression; $('format').value = calculation.format ?? ''; $('formula').focus() }
  const remove = element('button', 'Remove ' + calculation.id); remove.type = 'button'
  remove.onclick = () => { try { const next = input(); next.calculations = next.calculations.filter(item => item.id !== calculation.id); invalidate(); write(next); status('Calculation removed. Review the changed library before saving.') } catch (error) { status(error.message, true) } }
  actions.append(edit, remove)
 }); box.append(actions)
}
function reportView(box, report) {
 box.replaceChildren(); box.append(element('p', report.compatible ? 'All reported translations are compatible.' : 'Unresolved source semantics block approval.'))
 box.append(table('Source to native translations', ['Calculation', 'Kind', 'Language', 'Source expression', 'Native expression', 'Issues'], report.translations.map(item => [item.id, item.kind === 'field' ? 'Field · ' + item.dataType : 'Measure', item.language, item.sourceExpression, expressionText(item.targetExpression), item.issues.length?item.issues.map(i=>i.message).join(" "):"None"])))
 if (report.issues.length) box.append(table('Unresolved compatibility issues', ['Issue'], report.issues.map(issue => [text(issue)])))
}
function exactValues(box, caption, values) {
 if (values === undefined) return
 if (Array.isArray(values)) {
  if (!values.length) { box.append(element('p', caption + ': no rows.')); return }
  const first = values[0]
  if (Array.isArray(first)) box.append(table(caption, first.map((_, index) => 'Value ' + (index + 1)), values.map(row => row.map(text))))
  else if (first && typeof first === 'object') {
   const columns = [...new Set(values.flatMap(row => Object.keys(row)))]; box.append(table(caption, columns, values.map(row => columns.map(column => text(row[column])))))
  } else box.append(table(caption, ['Value'], values.map(value => [text(value)])))
 } else if (values && typeof values === 'object') box.append(table(caption, ['Name', 'Exact value'], Object.entries(values).map(([name, value]) => [name, text(value)])))
 else box.append(element('p', caption + ': ' + text(values)))
}
const exact=exactText
function resultView(box, result, groupBy = []) {
 box.replaceChildren()
 if (result.rows.length) {
  const measures = Object.keys(result.totals), dimensions = result.rows[0].dimensions.map((_, index) => groupBy[index] ?? 'Group ' + (index + 1))
  box.append(table('Exact calculation rows', [...dimensions, ...measures], result.rows.map(row => [...row.dimensions.map(text), ...measures.map(measure => exact(row.values[measure]))])))
 } else box.append(element('p', 'No rows match this calculation context.'))
 box.append(table('Filtered totals', ['Calculation', 'Exact value'], Object.entries(result.totals).map(([id, value]) => [id, exact(value)])))
 exactValues(box, 'Formats', result.formats)
 exactValues(box, 'Formatted totals', result.formatted?.totals)
 exactValues(box, 'Calculated field preview', result.fields)
 box.append(element('p', result.filteredRows + ' filtered rows from ' + result.inputRows + ' authorized input rows. Non-integral exact values are shown as numerator ÷ denominator. Display formats preserve the exact underlying value.'))
 const semantics = element('details'); semantics.append(element('summary', 'Evaluation semantics')); exactValues(semantics, 'Evaluation semantics', result.semantics); box.append(semantics)
 const details = element('details'); details.append(element('summary', 'Complete exact result'), element('pre', JSON.stringify(result, null, 2))); box.append(details)
}
async function refresh() {
 const catalog = await api(), oldView = $('view').value === '' ? null : views[Number($('view').value)], oldLibrary = $('library').value
 views = catalog.views; $('view').replaceChildren(); views.forEach((view, index) => $('view').add(new Option(view.viewId + ' · ' + view.modelId + ' · ' + view.revision, String(index))))
 if (oldView) { const index = views.findIndex(view => view.modelId === oldView.modelId && view.revision === oldView.revision && view.viewId === oldView.viewId); $('view').value = index < 0 ? '' : String(index) }
 $('library').replaceChildren(new Option('New library', '')); for (const library of catalog.libraries) $('library').add(new Option(library.label + ' · ' + library.revision, library.id))
 $('library').value = oldLibrary
 $('review').disabled = !views.length; $('migration-form').querySelector('button').disabled = !views.length; $('formula-form').querySelector('button').disabled = !views.length
 if (views.length && $('view').value !== '') showView()
}
async function loadLibrary(id) {
 const library = await api('/' + encodeURIComponent(id)), value = library.input
 invalidate(); staleMigration(); $('library-id').value = value.id; $('label').value = value.label; write(value)
 const index = views.findIndex(view => view.modelId === value.modelId && view.revision === value.modelRevision && view.viewId === value.viewId)
 $('view').value = index < 0 ? '' : String(index)
 if (index < 0) { $('view-context').replaceChildren(element('p', 'The saved model revision is no longer available. Select a current governed view and review the library again.')); status('Saved library loaded. Its governed revision is unavailable.', true); return }
 showView(); saved = { id: library.id, revision: library.revision, compatible: library.report.compatible }; $('library').value = library.id; reportView($('saved-report'), library.report); showSaved(); status(library.report.compatible ? 'Saved library loaded with its exact governed revision.' : 'Original library loaded with unresolved source semantics. Review the compatibility report before activation.', !library.report.compatible)
}
function showSaved() { $('saved-note').textContent = 'Library ' + saved.id + ' · revision ' + saved.revision + '. Runs use this saved revision and the supplied context.'; $('run').disabled = saved.compatible === false; $('run-panel').hidden = false }

$('formula-form').onsubmit = event => {
 event.preventDefault(); act(async () => {
  const value = input(), calculation = { id: $('calculation-id').value, language: $('language').value, sourceExpression: $('formula').value, ...($('calculation-kind').value === 'field' ? { kind: 'field', dataType: $('field-type').value } : {}), ...($('format').value ? { format: $('format').value } : {}) }
  if (value.source) throw Error('This library retains an original source container. Start a new library to author an equivalent formula, or explicitly edit the source in the full definition.')
  if (calculation.language === 'native') { try { calculation.expression = JSON.parse(calculation.sourceExpression) } catch { throw Error('A native expression must be valid expression JSON. Choose Excel, DAX or Tableau for formula text.') } }
  const index = value.calculations.findIndex(item => item.id === calculation.id)
  if (index < 0) value.calculations.push(calculation); else value.calculations[index] = calculation
  invalidate(); write(value); status('Formula added to the library. Review translations and exact results before saving.')
 })
}
$('clear-formula').onclick = clearFormula
$('calculation-kind').onchange = formulaKind
$('use-document').onclick = () => act(async () => { const value = bind(parseDocument()); if (typeof value.id !== 'string' || typeof value.label !== 'string') throw Error('The library must have an id and label.'); $('library-id').value = value.id; $('label').value = value.label; invalidate(); staleMigration(); write(value); status('Library definition loaded with the selected governed context.') })
$('document').oninput = invalidate
for (const id of ['library-id', 'label']) $(id).oninput = () => { invalidate(); staleMigration() }
$('view').onchange = () => act(async () => { invalidate(); staleMigration(); showView(); write(bind(parseDocument())); status('Governed view changed. Review the rebound calculations before saving.') })
$('library').onchange = () => act(async () => {
 if ($('library').value) await loadLibrary($('library').value)
 else { invalidate(); staleMigration(); $('library-id').value = ''; $('label').value = ''; write(bind({ version: 1, id: '', label: '', calculations: [], groups: [], parameters: [], fieldParameters: [] })); clearFormula(); status('Ready for a new library.') }
})
$('review').onclick = () => act(async () => {
 const value = input(); invalidate(); const result = await api('/review', { input: value }); reviewed = result
 write(result.input); reportView($('review-results'), result.report)
 if (result.preview) resultView($('preview-results'), result.preview); else $('preview-results').replaceChildren(element('p', 'Exact preview is unavailable until the reported source semantics are resolved.'))
 $('review-json').textContent = JSON.stringify(result, null, 2); $('review-digest').textContent = 'Reviewed digest: ' + result.digest; $('review-panel').hidden = false
 status(result.report.compatible ? 'Review complete. Approve this exact input and its results to save.' : 'Review found unresolved semantics. Correct the reported gaps before saving.'); controls()
})
$('approve').onchange = controls
$('save').onclick = () => act(async () => {
 if (!reviewed?.report.compatible || !$('approve').checked) throw Error('Review and approve this exact compatible library first.')
 saved = await api('/save', { input: reviewed.input, reviewedDigest: reviewed.digest }); reportView($('saved-report'), reviewed.report); $('approve').checked = false; reviewed = null; $('review-panel').hidden = true
 await refresh(); $('library').value = saved.id; showSaved(); status('Reviewed calculation library saved.')
})
$('run-options').oninput = () => { $('run-results').hidden = true }
$('run').onclick = () => act(async () => {
 if (!saved) throw Error('Save or load a reviewed library first.')
 $('run-results').hidden = true
 let options; try { options = JSON.parse($('run-options').value) } catch { throw Error('Run options must be valid JSON.') }
 if (!options || !Array.isArray(options.filters) || !Array.isArray(options.groupBy) || !Array.isArray(options.groups) || !options.parameters || typeof options.parameters !== 'object' || Array.isArray(options.parameters)) throw Error('Run options require filters, groupBy and groups arrays and a parameters object.')
 const result = await api('/' + encodeURIComponent(saved.id) + '/run', { filters: options.filters, groupBy: options.groupBy, parameters: options.parameters, groups: options.groups, ...(options.fieldParameter === undefined ? {} : { fieldParameter: options.fieldParameter }), revision: saved.revision })
 const box = $('run-results'); resultView(box, result.answer, options.fieldParameter ? [] : options.groupBy); box.append(metadata([['Answer id', result.id]])); const retained=element('a','Open retained exact answer');retained.href='/api/operator/calculations/'+encodeURIComponent(saved.id)+'/answers/'+result.id;box.append(retained); const details = element('details'); details.append(element('summary', 'Saved answer and governed context'), element('pre', JSON.stringify(result, null, 2))); box.append(details); box.hidden = false; status('Saved calculation revision evaluated. Inspect exact values and exposed context.')
})
$('migration-file').onchange = staleMigration
$('migration-form').onsubmit = event => {
 event.preventDefault(); act(async () => {
  const file = $('migration-file').files[0]; if (!file || file.size > 1048576) throw Error('Choose an original library JSON envelope of at most 1 MiB.')
  let original; try { original = JSON.parse(await file.text()) } catch { throw Error('The original library envelope must be valid JSON.') }
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw Error('The original library envelope must be an object.')
  const value = bind(original), binding = { id: value.id, modelId: value.modelId, viewId: value.viewId }
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.id)) throw Error('The original envelope must contain a valid library id.')
  staleMigration(); const call = (action, data) => importCall(action, data, binding), uploadId = await upload(value, call, status, value.id), history = await call('history')
  const plan = await call('plan', { uploadId, ...(history.history.length ? { catchup: true } : {}) }); migration = { plan, binding, stale: false }; $('migration-approve').checked = false
  const box = $('migration-results'); box.replaceChildren(metadata([['Library', value.id], ['Governed model', value.modelId], ['View', value.viewId], ['Fingerprint', plan.fingerprint], ['Plan counts', text(plan.counts)]]))
  if (plan.project?.report) { const report = element('div'); reportView(report, plan.project.report); box.append(report) }
  $('migration-json').textContent = JSON.stringify(plan, null, 2); $('migration-review').hidden = false; status(plan.counts.rejected ? 'Migration plan contains rejected items. Review the gaps before correcting the source.' : 'Migration ready for exact plan approval.'); controls()
 })
}
$('migration-approve').onchange = controls
$('migration-apply').onclick = () => act(async () => {
 if (!migration || migration.stale || migration.plan.counts.rejected || !$('migration-approve').checked) throw Error('Preview and approve this exact migration plan first.')
 const { plan, binding } = migration; let completed = false
 for (let attempt = 0; attempt < 20; attempt++) {
  const result = await importCall('apply', { planId: plan.planId, reviewedFingerprint: plan.fingerprint }, binding)
  if (result.job.state === 'completed') { completed = true; break }
  if (!['queued', 'applying'].includes(result.job.state)) throw Error('Migration stopped: ' + result.job.state)
 }
 if (!completed) { status('Migration checkpoint saved. Continue Apply and reconcile for this same approved plan.'); return }
 const receipt = await importCall('reconcile', { planId: plan.planId }, binding)
 if (!receipt.ok) throw Error('Migration reconciliation failed. Inspect the plan before continuing.')
 imported = { plan, binding }; migration = null; $('migration-review').hidden = true; $('migration-receipt-json').textContent = JSON.stringify(receipt, null, 2); $('migration-revert').hidden = false; $('migration-receipt').hidden = false
 await refresh(); await loadLibrary(binding.id); status(saved?.compatible ? 'Original calculation library imported and reconciled. The saved revision is ready to inspect and run.' : 'Original library imported and reconciled. Unresolved source semantics block calculation runs.', !saved?.compatible)
})
$('migration-undo').onclick = () => act(async () => {
 if (!migration) throw Error('No migration plan is available to undo.')
 await importCall('undo', { planId: migration.plan.planId }, migration.binding); migration = null; $('migration-review').hidden = true; status('Migration plan undone.')
})
$('migration-revert').onclick = () => act(async () => {
 if (!imported) throw Error('No imported revision is available to undo.')
 const receipt = await importCall('undo', { planId: imported.plan.planId }, imported.binding); imported = null; invalidate(); $('migration-revert').hidden = true; $('migration-receipt-json').textContent = JSON.stringify(receipt, null, 2); await refresh(); status('Imported revision undone. Reload a remaining library to inspect its current state.')
})
await act(async () => {
 await refresh(); write({ version: 1, id: '', label: '', calculations: [], groups: [], parameters: [], fieldParameters: [] })
 if (!views.length) { status('No published governed views yet. Create and publish a semantic model first.'); return }
 write(bind(parseDocument())); const id = new URL(location.href).searchParams.get('library')
 if (id) await loadLibrary(id); else status('Choose a governed view and write your first formula, or open a saved library.')
})
