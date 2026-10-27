const status = document.querySelector('#alert-status')
const authoring = document.querySelector('#alert-create')
if (authoring) {
 const showCondition = () => {
  const threshold = authoring.elements.kind.value === 'threshold', keyed = authoring.elements.comparison.value === 'stable-key'
  authoring.querySelector('details').hidden = !threshold
  authoring.querySelector('details').open = threshold
  for (const name of ['measure', 'value']) authoring.elements[name].required = threshold
  authoring.elements.columns.closest('label').hidden = !keyed
  authoring.elements.columns.required = keyed
 }
 authoring.elements.kind.addEventListener('change', showCondition)
 authoring.elements.comparison.addEventListener('change', showCondition)
 showCondition()
}
for (const form of document.querySelectorAll('form[data-alert-action]')) {
 form.addEventListener('submit', async event => {
  event.preventDefault()
  const values = Object.fromEntries(new FormData(form)), action = form.dataset.alertAction, button = form.querySelector('button[type="submit"]')
  let path = '/api/operator/alerts', body = {}
  if (action === 'create') {
   body = {title: values.title, queryId: values.queryId, predicate: values.kind === 'threshold' ? {kind: values.kind, measure: values.measure, op: values.op, value: values.value} : {kind: values.kind}, comparison: values.comparison === 'stable-key' ? {kind: 'stable-key', columns: values.columns.split(',').map(column => column.trim()).filter(Boolean)} : {kind: 'multiset'}, behavior: values.behavior, baseline: values.baseline}
  } else {
   path += '/' + form.dataset.ruleId + '/' + action
   body = action === 'evaluate' ? {requestId: crypto.randomUUID()} : values
  }
  button.disabled = true; status.textContent = 'Saving…'
  try {
   const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
   const result = await response.json()
   if (!response.ok) throw new Error(result.error || 'alert_conflict')
   location.assign(action === 'create' ? '/app/alerts/' + result.rule.id : '/app/alerts/' + form.dataset.ruleId + (action === 'evaluate' ? '?checked=1' : ''))
  } catch (error) {
   const refusals = {alert_query_currency_changed: 'The query currency changed. Save a new query in the current currency and author a new alert; the existing baseline and episode are unchanged.', alert_conflict: 'The alert, session or source changed. Reload and review the current state before checking again.', alert_quality_unhealthy: 'This source has failed, stale or unknown data-quality evidence. Its baseline and episode are unchanged. Run the current source checks in Data quality before checking again.'}
   status.textContent = refusals[error.message] || 'Could not save: ' + error.message.replaceAll('_', ' ') + '. Review the rule and current source before trying again.'
   button.disabled = false
  }
 })
}
