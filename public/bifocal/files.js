import { element, table, metadata, sourceView } from './file-view.js'
import { envelope, upload, originalFile } from './file-upload.js'
const $ = id => document.getElementById(id), form = $('import-form')
let plan, planDataset, current, reviewedDataset, nextErrors, activeInput, busy = false
function status(text, error = false) { $('status').textContent = text; $('status').dataset.error = String(error) }
async function request(path, body, dataset, method = body === undefined ? 'GET' : 'POST') {
 const response = await fetch(path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), 'X-Import-Dataset': dataset }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 const data = await response.json()
 if (!response.ok) throw Error([data.error, data.reason, data.details?.reason].filter(Boolean).join(': '))
 return data
}
const call = (action, body, dataset) => request('/api/operator/import/' + action, body, dataset)
async function action(work) {
 if (busy) return
 busy = true; status('Working…'); document.querySelectorAll('button').forEach(button => { button.dataset.previousDisabled = String(button.disabled); button.disabled = true })
 try { await work() } catch (error) { status(error.message + ' The last committed dataset remains available.', true) }
 finally { busy = false; document.querySelectorAll('button').forEach(button => { button.disabled = button.dataset.previousDisabled === 'true' }); $('apply').disabled = !plan || !!plan.counts.rejected || !$('approve').checked }
}
form.elements.dataset.addEventListener('input', () => {
 plan = null; current = null; reviewedDataset = null; activeInput = null
 $('review').hidden = true; $('approve').checked = false; $('apply').disabled = true
 $('current-empty').textContent = 'Choose Load dataset to review this dataset.'
 $('current-table').replaceChildren(); $('history-list').replaceChildren(); $('erase-id').value = ''
})
function showErrors(validation, append = false) {
 $('errors').hidden = !validation?.errorCount
 if (!validation) return
 $('error-total').textContent = `${validation.errorCount} cell errors. Fix the file or explicitly map a replacement schema. No rows will publish.`
 if (!append) $('error-list').replaceChildren()
 if (validation.errors.length) $('error-list').append(table('Row validation errors', ['Row', 'Column', 'Name', 'Expected'], validation.errors.map(error => [error.row, error.column, error.name, error.expected])))
 nextErrors = validation.nextOffset; $('more-errors').hidden = nextErrors === null
}
function renderPlan(value, dataset) {
 plan = value; planDataset = dataset; $('review').dataset.planId = value.planId; $('review').hidden = false; $('approve').checked = false
 const preview = value.preview, columns = preview?.columns ?? value.validation?.columns ?? []
 $('plan-summary').replaceChildren(metadata([['Dataset', dataset], ['Fingerprint', value.fingerprint], ['Result rows', preview?.rowCount ?? 'Blocked'], ['Selected key', preview?.key], ['Detected candidate keys', preview?.keyCandidates?.join(', ') ?? 'None']]))
 $('sample').replaceChildren(preview ? table('First five resulting rows', columns.map(column => column.name), preview.sample) : element('p', value.rejected.map(row => row.reason).join('\n'), 'warning'))
 $('mapping').replaceChildren(table('Reviewed column mapping', ['Column', 'Type'], columns.map(column => [column.name, column.type])))
 $('source').replaceChildren(preview ? sourceView(preview.source, preview.updatedAt) : element('p', 'No valid table is proposed. Original upload remains in custody until dataset erasure.'))
 showErrors(value.validation); $('apply').disabled = true
 $('review').scrollIntoView({ block: 'start' }); status(value.counts.rejected ? 'Import blocked. Inspect the errors before cancelling and correcting it.' : 'Plan ready. Review the rows, source and exact fingerprint before approving.')
}
async function load(id = form.elements.dataset.value) {
 if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw Error('Enter a valid dataset id.')
 const response = await fetch('/api/operator/datasets/' + id), data = await response.json()
 if (!response.ok && response.status !== 404) throw Error(data.reason ?? data.error)
 current = response.ok ? data : null; reviewedDataset = id
 $('current-empty').textContent = current ? `Revision ${current.revision}. ${current.table.rows.length} rows.` : 'No table is published. Retained rejected or undone imports can still be erased.'
 $('current-table').replaceChildren(...current ? [sourceView(current.table.source, current.table.updatedAt), table('Current rows (first 20)', current.table.columns.map(column => column.name), current.table.rows.slice(0, 20))] : [])
 const history = await call('history', undefined, id); $('history-list').replaceChildren()
 for (const item of history.history) {
  const row = element('div', undefined, 'history-item'); row.append(element('p', `${item.state} · ${item.owner} · ${item.approvedAt}`), element('p', `Plan ${item.planId} · ${item.fingerprint}`))
  const original = element('button', 'Download original'); original.type = 'button'; original.onclick = () => action(async () => {
   const value = await call('original/' + item.planId, undefined, id)
   const file=originalFile(value.originals)
   const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/octet-stream' })), link = element('a'); link.href = url; link.download = file.name; link.click(); status('Original downloaded.'); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }); row.append(original)
  if (item.state === 'completed') { const undo = element('button', 'Undo import'); undo.type = 'button'; undo.onclick = () => action(async () => { await call('undo', { planId: item.planId }, id); await load(id); status('Import undone. Previous data restored. Retained originals remain owner-erasable.') }); row.append(undo) }
  $('history-list').append(row)
 }
 if (!history.history.length) $('history-list').append(element('p', 'No approved versions.'))
}
form.onsubmit = event => { event.preventDefault(); action(async () => {
 activeInput = await envelope(form); await load(activeInput.datasetId); $('resume').hidden = false
 const uploadId = await upload(activeInput, call, status)
 const history = await call('history', undefined, activeInput.datasetId)
 renderPlan(await call('plan', { uploadId, ...(history.history.length ? { catchup: true } : {}) }, activeInput.datasetId), activeInput.datasetId)
 $('resume').hidden = true
}) }
$('resume').onclick = () => form.requestSubmit()
$('load').onclick = () => action(async () => { await load(); status('Dataset state and history loaded for review.') })
$('approve').onchange = () => { $('apply').disabled = !plan || !!plan.counts.rejected || !$('approve').checked }
$('apply').onclick = () => action(async () => {
 if (!plan || plan.counts.rejected || !$('approve').checked) throw Error('Review and approve the exact plan first.')
 let completed = false
 for (let attempt = 0; attempt < 20; attempt++) { const result = await call('apply', { planId: plan.planId, reviewedFingerprint: plan.fingerprint }, planDataset); status(`Import job: ${result.job.state}`); if (result.job.state === 'completed') { completed = true; break }; if (!['queued','applying'].includes(result.job.state)) throw Error('Import did not complete: ' + result.job.state) }
 if (!completed) throw Error('Import is still in progress. Keep the reviewed plan and resume explicitly.')
 const result = await call('reconcile', { planId: plan.planId }, planDataset)
 if (!result.ok) throw Error('Import reconciliation failed. Inspect the job before claiming completion.')
 await load(planDataset); status('Import completed and reconciled. Current data and originals are available below.'); plan = null; $('approve').checked = false
})
$('cancel').onclick = () => action(async () => { if (!plan) throw Error('No pending plan.'); await call('undo', { planId: plan.planId }, planDataset); plan = null; $('approve').checked = false; status('Import cancelled. The error inventory remains available until dataset erasure.') })
$('more-errors').onclick = () => action(async () => { if (nextErrors !== null) showErrors(await call(`review/${plan?.planId ?? $('review').dataset.planId}?offset=${nextErrors}`, undefined, planDataset), true) })
$('erase').onclick = () => action(async () => {
 const id = form.elements.dataset.value
 if (!reviewedDataset || reviewedDataset !== id || $('erase-id').value !== id) throw Error('Load this dataset, review its state and type its exact id before erasing.')
 const receipt = await request(`/api/operator/datasets/${id}/erase`, { confirmDataset: id, reviewedRevision: current?.revision ?? null }, id)
 $('current-table').replaceChildren(element('p', receipt.reason), table('Erasure store counts', ['Store', 'Rows'], receipt.stores.map(store => [store.store, store.rows])))
 $('history-list').querySelectorAll('button').forEach(button => button.remove());
 $('current-empty').textContent = `Erasure ${receipt.phase}. Receipt ${receipt.receiptId}.`; reviewedDataset = null; plan = null; current = null; activeInput = null; $('review').hidden = true; for(const id of ['plan-summary','sample','error-list','mapping','source'])$(id).replaceChildren(); form.elements.file.value=''; sessionStorage.removeItem('bifocal-upload:'+id); status('Dataset erased. Its id is retired; use a new id for new data.')
})

$('range-form').onsubmit = event => { event.preventDefault(); const rangeForm = event.currentTarget; action(async () => {
 const datasetId = form.elements.dataset.value
 if (!/^[a-z][a-z0-9-]{0,63}$/.test(datasetId)) throw Error('Enter the target dataset id above.')
 const accessToken = rangeForm.elements.token.value; rangeForm.elements.token.value = ''
 const history = await call('history', undefined, datasetId)
 const input = {provider:rangeForm.elements.provider.value,workbook:rangeForm.elements.workbook.value,sheet:rangeForm.elements.sheet.value,range:rangeForm.elements.range.value,datasetId,mode:form.elements.mode.value,nullValue:form.elements.null.value,formulaTreatment:'cached-values-preserve-formulas',confirmRead:rangeForm.elements.consent.checked,accessToken,...(history.history.length ? {catchup:true}:{}),...(form.elements.key.value ? {key:form.elements.key.value}:{})}
 if (form.elements.columns.value.trim()) input.columns=JSON.parse(form.elements.columns.value)
 renderPlan(await request('/api/operator/spreadsheets/preview',input,datasetId),datasetId)
 }) }
