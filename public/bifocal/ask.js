import { element, metadata, table } from './file-view.js'
import { figure, label, stamp, when } from './format.js'

const $ = id => document.getElementById(id), zone = document.body.dataset.zone
const json = value => JSON.stringify(value, null, 2)
const shown = (value, currency) => value.state === 'value' ? figure(value.value, value.unit, currency) : value.state.toUpperCase()
let views = [], history = [], previewed = null, current = null, originalRequest = null, busy = false
function status(message, error = false) { $('ask-status').textContent = message; $('ask-status').dataset.error = String(error); $('ask-status').setAttribute('role', error ? 'alert' : 'status') }
async function api(path = '', data) {
 const response = await fetch('/api/operator/ask' + path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
 const value = await response.json()
 if (!response.ok) throw Error(String(value.reason ?? value.error ?? 'Question request failed.').replaceAll('_', ' '))
 return value
}
async function act(work) {
 if (busy) return
 busy = true; $('ask-workspace').inert = true; $('ask-workspace').setAttribute('aria-busy', 'true'); status('Working…')
 try { await work() } catch (error) { status(error.message, true) }
 finally { busy = false; $('ask-workspace').inert = false; $('ask-workspace').removeAttribute('aria-busy'); consentControl() }
}
function consentControl() { $('ask-send').disabled = !previewed || !$('ask-consent').checked }
function invalidate() {
 previewed = null; $('ask-consent').checked = false; $('ask-consent-panel').hidden = true; $('ask-result').hidden = true; consentControl()
}
function selectedView() {
 const view = $('ask-view').value === '' ? null : views[Number($('ask-view').value)]
 if (!view) throw Error('Choose a published governed view first.')
 return view
}
function body() {
 if (!$('ask-form').reportValidity()) throw Error('Enter a question and explicit as of date.')
 const view = selectedView(), question = $('ask-question').value
 if (!question.trim()) throw Error('Write a question about the selected view.')
 let context
 try { context = JSON.parse($('ask-context').value) } catch { throw Error('Question context must be valid JSON or null.') }
 if (context !== null && (!context || typeof context !== 'object' || Array.isArray(context) || !Array.isArray(context.groupBy) || !Array.isArray(context.measureIds) || !Array.isArray(context.filters) || !(context.period === null || context.period && typeof context.period === 'object' && !Array.isArray(context.period)))) throw Error('Context needs groupBy, measureIds and filters arrays, and a period object or null.')
 return { modelId: view.modelId, revision: view.revision, viewId: view.viewId, question, asOf: $('ask-as-of').value, context }
}
function definitions() {
 const view = selectedView(), box = $('ask-definitions'); box.replaceChildren()
 box.append(metadata([['Model', view.modelId], ['Published revision', view.revision], ['View', view.viewId]]))
 box.append(table('Governed dimensions', ['Dimension', 'Type'], view.dimensions.map(field => [field.column, field.type])))
 box.append(table('Governed measures', ['Measure', 'Definition'], view.measures.map(measure => [measure.id, json(measure)])))
 const details = element('details'); details.append(element('summary', 'Model row rules, source filters and fiscal context'), element('pre', json({ rowRules: view.rowRules, filters: view.filters, fiscal: view.fiscal }))); box.append(details)
}
function renderHistory() {
 const box = $('ask-history'); box.replaceChildren()
 for (const item of history) {
  const link = element('a'), time = element('time', when(item.createdAt, zone), 'row-meta'); time.dateTime = item.createdAt; link.href = '/app/ask?question=' + encodeURIComponent(item.id)
  link.append(element('span', item.question), time); if (item.id === current?.id) link.setAttribute('aria-current', 'true'); box.append(link)
 }
 if (!history.length) box.append(element('p', 'No saved AI questions yet.', 'side-note'))
}
function valuesTable(snapshot) {
 const answer = snapshot.answer, measures = Object.keys(answer.totals), dimensions = snapshot.definition.groupBy
 const wrap = table('Native query results', [...dimensions.map(label), ...measures.map(label)], answer.rows.map(row => [...row.dimensions, ...measures.map(id => shown(row.values[id], snapshot.context.currency))]), [...dimensions.map(() => false), ...measures.map(() => true)])
 wrap.querySelectorAll('tbody tr').forEach((row, index) => measures.forEach((id, measureIndex) => {
  const cell = row.children[dimensions.length + measureIndex]; cell.id = 'ask-value-' + index + '-' + measureIndex; cell.tabIndex = -1; cell.title = json(answer.rows[index].values[id])
 }))
 $('ask-table').replaceChildren(wrap)
 if (!answer.rows.length) $('ask-table').append(element('p', 'No rows match the native query.'))
}
function chart() {
 const snapshot = current.snapshot, metric = $('ask-chart-metric').value, box = $('ask-chart'); box.replaceChildren()
 const measureIndex = Object.keys(snapshot.answer.totals).indexOf(metric)
 if (measureIndex < 0) { box.append(element('p', 'No native measure is available to chart.')); return }
 const rows = snapshot.answer.rows.map((row, index) => ({ row, index, value: row.values[metric] })).filter(item => item.value.state === 'value' && typeof item.value.value === 'string')
 if (!rows.length) { box.append(element('p', 'This measure has no value states to chart. Its exact states remain in the table.')); return }
 const points = rows.slice(0, 20).map(item => ({ ...item, number: Number(item.value.value) }))
 if (points.some(item => !Number.isFinite(item.number))) { box.append(element('p', 'These values exceed the chart display range. Inspect their exact values in the table.')); return }
 const minimum = Math.min(0, ...points.map(item => item.number)), maximum = Math.max(0, ...points.map(item => item.number)), range = maximum - minimum
 if (!Number.isFinite(range)) { box.append(element('p', 'These values exceed the chart display range. Inspect their exact values in the table.')); return }
 const x = value => range ? 6 + (value - minimum) / range * 588 : 6, zero = x(0), ns = 'http://www.w3.org/2000/svg'
 box.append(element('h3', label(metric)), element('p', 'Bars link to their exact table cells. The vertical line marks zero.'))
 for (const point of points) {
  const name = point.row.dimensions.length ? point.row.dimensions.map(value => value === null ? 'NULL' : String(value)).join(' · ') : 'All matching rows'
  const value = shown(point.value, snapshot.context.currency), link = element('a', undefined, 'ask-chart-row'), cellId = 'ask-value-' + point.index + '-' + measureIndex
  link.href = '#' + cellId; link.setAttribute('aria-label', name + ': ' + value + '. Open exact result cell.'); link.append(element('span', name, 'ask-chart-name'), element('span', value, 'ask-chart-value'))
  link.onclick = () => $(cellId).focus({ preventScroll: true })
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 600 24'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true')
  const baseline = document.createElementNS(ns, 'line'); baseline.setAttribute('x1', String(zero)); baseline.setAttribute('x2', String(zero)); baseline.setAttribute('y1', '0'); baseline.setAttribute('y2', '24'); baseline.setAttribute('class', 'ask-chart-zero')
  const bar = document.createElementNS(ns, 'rect'), position = x(point.number); bar.setAttribute('x', String(Math.min(zero, position))); bar.setAttribute('y', '4'); bar.setAttribute('width', String(Math.abs(position - zero))); bar.setAttribute('height', '16'); svg.append(bar, baseline); link.append(svg); box.append(link)
 }
 if (rows.length > points.length) box.append(element('p', 'Chart shows the first 20 value states. The table contains every returned row.'))
}
function rational(numerator, denominator) {
 let left = numerator < 0n ? -numerator : numerator, right = denominator
 while (right) { const next = left % right; left = right; right = next }
 return { numerator: String(numerator / left), denominator: String(denominator / left) }
}
function combine(left, right, subtract = false) {
 const a = BigInt(left.numerator), b = BigInt(left.denominator), c = BigInt(right.numerator), d = BigInt(right.denominator)
 return rational(a * d + (subtract ? -c : c) * b, b * d)
}
function exactText(value, unit = 'number', currency) {
 if (value === undefined) return 'Not supplied'
 if (value === null) return 'Unavailable'
 const numerator = BigInt(value.numerator), denominator = BigInt(value.denominator)
 let remaining = denominator, twos = 0, fives = 0
 while (remaining % 2n === 0n) { remaining /= 2n; twos++ }
 while (remaining % 5n === 0n) { remaining /= 5n; fives++ }
 const suffix = unit === 'percentage-points' ? ' pp' : ''
 if (remaining !== 1n) { const fraction = figure(value.numerator, 'number') + ' ÷ ' + figure(value.denominator, 'number'); return unit === 'money' ? '(' + fraction + ') ' + currency : unit === 'percent' ? '(' + fraction + ')%' : fraction + suffix }
 const scale = Math.max(twos, fives), scaled = numerator * 10n ** BigInt(scale) / denominator, absolute = scaled < 0n ? -scaled : scaled, digits = String(absolute).padStart(scale + 1, '0')
 const decimal = (scaled < 0n ? '-' : '') + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits)
 return figure(decimal, unit === 'percentage-points' ? 'number' : unit, currency) + suffix
}
function evidenceValue(value, currency) {
 if (value === null) return 'No group in this period'
 if (value.state !== 'value') return label(value.state) + (value.reason ? ' · ' + label(value.reason) : '')
 return exactText(value.exact, value.unit, currency)
}
function delta(before, after) { return before?.state === 'value' && after?.state === 'value' && before.exact && after.exact ? combine(after.exact, before.exact, true) : null }
const changeUnit = unit => unit === 'percent' ? 'percentage-points' : unit
const groupName = values => values.map(value => value === null ? 'NULL' : String(value)).join(' · ')
function evidenceDetails(title, value) { const details = element('details'); details.append(element('summary', title), element('pre', json(value))); return details }
function qualityView(box, quality) {
 box.append(element('h4', 'Data quality: ' + label(quality.state)))
 const failed = quality.tests.filter(test => test.state === 'failed'), unchecked = quality.tests.filter(test => test.state === 'unknown'), passed = quality.tests.filter(test => test.state === 'passed')
 box.append(element('p', failed.length + ' failed checks · ' + unchecked.length + ' unknown or unchecked · ' + passed.length + ' passed.'))
 const checks = (title, tests) => table(title, ['Dataset', 'Check', 'State', 'Reason', 'Waiver'], tests.map(test => [test.dataset, test.name ?? test.ruleId ?? 'Dataset evidence', label(test.state), label(test.reason), test.waiver ? (test.waiver.active ? 'Active' : 'Expired') + ': ' + test.waiver.reason + ' · expires ' + stamp(test.waiver.expires_at, zone) : 'None']))
 if (failed.length) box.append(checks('Failed quality checks', failed))
 if (unchecked.length) box.append(checks('Unknown or unchecked quality evidence', unchecked))
 if (passed.length) { const details = element('details'); details.append(element('summary', 'Passed checks (' + passed.length + ')'), checks('Passed quality checks', passed)); box.append(details) }
 const link = element('a', 'Inspect data quality checks'); link.href = '/app/quality'; box.append(link)
}
function periodName(period) { return period.kind === 'all' ? 'All dates' : label(period.kind) + ' · ' + period.from + ' through ' + period.to + ' · as of ' + period.asOf }
function comparisonView(box, why, result, currency) {
 box.append(element('h4', 'Current and prior periods'), metadata([['Current period', periodName(result.interpretation.period)], ['Prior period', periodName(why.comparison.period)]]))
 box.append(table('Exact period comparison', ['Measure', 'Prior', 'Current', 'Delta'], Object.entries(why.after.totals).map(([id, after]) => { const before = why.before.totals[id]; return [label(id), evidenceValue(before, currency), evidenceValue(after, currency), exactText(delta(before, after), changeUnit(after.unit), currency)] })))
 const links = element('div', undefined, 'actions'), prior = element('a', 'Open prior native query'), current = element('a', 'Open current native query'); prior.href = '/app/queries/' + encodeURIComponent(why.comparison.queryId); current.href = '/app/queries/' + encodeURIComponent(result.snapshot.queryId); links.append(prior, current); box.append(links)
}
function driversView(box, why, currency) {
 for (const driver of why.dimensions) {
  const section = element('section', undefined, 'ask-driver-section'), unit = why.after.totals[driver.metric].unit
  section.append(element('h4', label(driver.metric) + ' by ' + label(driver.dimension)), element('p', driver.method))
  section.append(table('Permitted ' + driver.dimension + ' contributions', ['Group', 'Prior', 'Current', 'Delta', 'Reported contribution'], driver.rows.map(row => [groupName(row.dimensions), evidenceValue(row.before, currency), evidenceValue(row.after, currency), exactText(delta(row.before, row.after), changeUnit(unit), currency), exactText(row.contribution, changeUnit(unit), currency)])))
  box.append(section)
 }
}
function priceVolumeView(box, decomposition) {
 const section = element('section', undefined, 'ask-driver-section'); section.append(element('h4', 'Price, volume and residual: ' + label(decomposition.state)))
 if (decomposition.reason) section.append(element('p', decomposition.reason))
 if (decomposition.state === 'unavailable') { box.append(section); return }
 section.append(element('p', decomposition.method))
 const sum = combine(combine(decomposition.price, decomposition.volume), decomposition.unpricedResidual)
 const complete = decomposition.rows.length > 0 && decomposition.rows.every(row => row.state === 'computed' || row.state === 'unpriced')
 const observed = complete ? decomposition.rows.map(row => row.state === 'computed' ? row.delta : row.residual).reduce((left, right) => combine(left, right)) : null
 const difference = observed ? combine(observed, sum, true) : null
 section.append(table('Exact revenue change reconciliation', ['Component', 'Exact value'], [['Price effect', exactText(decomposition.price)], ['Volume effect', exactText(decomposition.volume)], ['Unpriced residual', exactText(decomposition.unpricedResidual)], ['Sum of reported components', exactText(sum)], ['Observed revenue delta across all products', exactText(observed)], ['Observed delta less component sum', exactText(difference)]]))
 if (difference) section.append(element('p', BigInt(difference.numerator) === 0n ? 'The reported components reconcile exactly to the revenue change across all reported products.' : 'The reported components differ from the observed revenue change by ' + exactText(difference) + '.'))
 else section.append(element('p', decomposition.state === 'incomplete' ? 'One or more products lack complete values. Reported component amounts are a subtotal; a complete revenue reconciliation is unavailable.' : 'No product-level revenue changes were supplied for a full reconciliation.'))
 section.append(table('Product contributions in exact revenue units', ['Product', 'State', 'Prior revenue', 'Current revenue', 'Price', 'Volume', 'Residual', 'Delta', 'Reason'], decomposition.rows.map(row => [groupName(row.product), label(row.state), exactText(row.beforeRevenue), exactText(row.afterRevenue), exactText(row.price), exactText(row.volume), exactText(row.residual), exactText(row.delta), row.reason ?? ''])))
 box.append(section)
}
function whyView(result) {
 const box = $('ask-why'); box.replaceChildren(); $('ask-why-panel').hidden = result.decision !== 'answer' || result.why === undefined || result.why === null
 if (result.decision !== 'answer' || result.why === undefined || result.why === null) return
 const why = result.why, currency = result.snapshot.context.currency
 qualityView(box, why.quality)
 const distinctions = element('dl', undefined, 'ask-evidence-labels')
 for (const [name, value] of [['Arithmetic', why.arithmetic], ['Correlation', why.correlation], ['Causal evidence', why.causalEvidence]]) distinctions.append(element('dt', name), element('dd', value))
 box.append(distinctions); comparisonView(box, why, result, currency); driversView(box, why, currency); priceVolumeView(box, why.priceVolume)
 if (why.hypotheses.length) { const list = element('ul'); why.hypotheses.forEach(hypothesis => list.append(element('li', typeof hypothesis === 'string' ? hypothesis : json(hypothesis)))); box.append(element('h4', 'Hypotheses'), list) }
 box.append(evidenceDetails('Complete original diagnostic and exact reconciliation data', why))
}
function nativeAnswer(snapshot, result) {
 const answer = snapshot.answer, currency = snapshot.context.currency, metricIds = Object.keys(answer.totals)
 $('ask-answer').hidden = false; $('ask-totals').replaceChildren()
 for (const id of metricIds) { const tile = element('div', undefined, 'kpi'); tile.append(element('span', label(id), 'kpi-label'), element('strong', shown(answer.totals[id], currency), 'kpi-value')); $('ask-totals').append(tile) }
 $('ask-scope').textContent = answer.filteredRows + ' matching rows from ' + answer.inputRows + ' source rows before model and query filtering. Native snapshot saved ' + stamp(snapshot.createdAt, zone) + '.'
 const warnings = []; if (answer.commonSnapshot === 'unavailable') warnings.push('No common upstream snapshot is available.'); if (answer.certification === 'unavailable') warnings.push('This native answer is not certified.')
 $('ask-quality').textContent = warnings.join(' '); $('ask-quality').hidden = !warnings.length
 valuesTable(snapshot); $('ask-chart-metric').replaceChildren(); metricIds.forEach(id => $('ask-chart-metric').add(new Option(label(id) + ' · ' + answer.totals[id].unit, id))); chart()
 const queryLink = element('a', 'Open the immutable native query'); queryLink.href = '/app/queries/' + encodeURIComponent(snapshot.queryId); $('ask-query-link').replaceChildren(queryLink)
 $('ask-interpretation').replaceChildren(element('h3', 'Interpreted dimensions, measures, filters and period'), element('pre', json(result.interpretation)))
 $('ask-query').textContent = json({ definition: snapshot.definition, metricDefinitions: snapshot.definition.measures, context: snapshot.context, exactTotals: answer.totals, semanticsVersion: answer.semanticsVersion, definitionHash: answer.definitionHash, snapshotDigest: snapshot.digest })
 const sources = $('ask-sources'); sources.replaceChildren(table('Native source watermarks', ['Dataset', 'Revision', 'Source updated', 'Content digest'], answer.sourceWatermarks.map(source => [source.dataset, source.revision, stamp(source.updatedAt, zone), source.sha256])))
 for (const source of answer.sourceWatermarks) { const paragraph = element('p'), citation = element('a', source.dataset + ' · revision ' + source.revision); citation.href = queryLink.href; paragraph.append(citation); sources.append(paragraph) }
}
function renderResult(result) {
 current = result; originalRequest = result.request; $('ask-result').hidden = false; $('ask-answer').hidden = true
 const title = result.decision === 'answer' ? 'Saved native answer' : result.decision === 'clarify' ? 'Clarification needed' : 'Question refused'
 $('ask-result-title').textContent = title; $('ask-result-question').textContent = result.question; $('ask-result-message').textContent = result.message
 $('ask-missing').replaceChildren()
 if (result.missing.length) { const list = element('ul'); for (const item of result.missing) list.append(element('li', typeof item === 'string' ? item : json(item))); $('ask-missing').append(element('h3', 'Required clarification'), list) }
 whyView(result)
 if (result.decision === 'answer') {
  if (!result.snapshot) throw Error('The answer did not include its native query snapshot.')
  nativeAnswer(result.snapshot, result)
 }
 $('ask-provider').replaceChildren(metadata([['AI model', result.provider.model], ['Provider response', result.provider.responseId], ['Saved', stamp(result.createdAt, zone)], ['Decision', result.decision]]))
 $('ask-receipt').textContent = json(result); $('ask-saved-link').href = '/app/ask?question=' + encodeURIComponent(result.id)
 const available = views.some(view => view.modelId === originalRequest.modelId && view.revision === originalRequest.revision && view.viewId === originalRequest.viewId)
 $('ask-follow-up').hidden = !result.interpretation || !available; renderHistory(); status(title + '. ' + result.message)
}
function restoreRequest(request) {
 const index = views.findIndex(view => view.modelId === request.modelId && view.revision === request.revision && view.viewId === request.viewId)
 if (index < 0) throw Error('The saved governed revision is unavailable for a follow-up. Choose a current view and review a new request.')
 $('ask-view').value = String(index); $('ask-as-of').value = request.asOf; $('ask-question').value = request.question; $('ask-context').value = json(request.context); definitions()
}

$('ask-form').oninput = () => { invalidate(); status('Review the exact AI request when your question is ready.') }
$('ask-view').onchange = () => { try { invalidate(); $('ask-context').value = 'null'; definitions(); status('Governed view selected. Write a question and choose its as of date.') } catch (error) { status(error.message, true) } }
$('ask-reset-context').onclick = () => { invalidate(); $('ask-context').value = 'null'; status('Follow-up context cleared. Review the new request before sending.') }
$('ask-form').onsubmit = event => { event.preventDefault(); act(async () => {
 const request = body(); invalidate(); const result = await api('/preview', request); previewed = { request, response: result, fingerprint: json(request) }
 $('ask-disclosure').textContent = result.disclosure; $('ask-outbound').textContent = json(result.outbound); $('ask-policy').textContent = 'Policy ' + result.policyVersion + ' · reviewed digest ' + result.digest
 $('ask-consent').checked = false; $('ask-consent-panel').hidden = false; consentControl(); status('Review the exact outbound question and definitions. Approval is required before sending to AI.')
}) }
$('ask-consent').onchange = consentControl
$('ask-send').onclick = () => act(async () => {
 if (!previewed || !$('ask-consent').checked) throw Error('Review and approve this exact AI request first.')
 if (json(body()) !== previewed.fingerprint) { invalidate(); throw Error('The question or context changed. Review the new AI request before sending.') }
 const approved = previewed; previewed = null; $('ask-consent').checked = false; $('ask-consent-panel').hidden = true; consentControl()
 const result = await api('/run', { ...approved.request, reviewedDigest: approved.response.digest, consent: true })
 history = [{ id: result.id, question: result.question, createdAt: result.createdAt }, ...history.filter(item => item.id !== result.id)]; renderResult(result)
})
$('ask-chart-metric').onchange = chart
$('ask-follow-up').onclick = () => {
 try {
  if (!current?.interpretation || !originalRequest) throw Error('This question has no reusable governed follow-up context.')
  restoreRequest(originalRequest); const context = current.interpretation; invalidate(); $('ask-context').value = json(context); $('ask-context-details').open = true; $('ask-question').value = ''; $('ask-question').focus(); status('Previous interpretation is now visible as follow-up context. Write your next question, then review its AI request.')
 } catch (error) { status(error.message, true) }
}
await act(async () => {
 const catalog = await api(); views = catalog.views; history = catalog.history; $('ask-view').replaceChildren()
 views.forEach((view, index) => $('ask-view').add(new Option(view.viewId + ' · ' + view.modelId + ' · ' + view.revision, String(index))))
 renderHistory(); $('ask-preview').disabled = !views.length
 if (views.length) definitions()
 const id = new URL(location.href).searchParams.get('question')
 if (id) {
  const result = await api('/' + encodeURIComponent(id)); renderResult(result)
  const available = views.some(view => view.modelId === result.request.modelId && view.revision === result.request.revision && view.viewId === result.request.viewId)
  if (available) restoreRequest(result.request); else status('Saved question loaded. Its model revision is no longer current; choose a current view for a new question.')
  return
 }
 status(views.length ? 'Choose a view and explicit as of date, then write your question. Nothing is sent to AI until you review and approve it.' : 'No published governed views yet. Create and publish a semantic model before asking AI.')
})
