// Uses the existing file review, approval, reconciliation and custody controls.
export function attachSmartsheet({ form, action, request, load, renderPlan, invalidate }) {
 const sourceForm = document.getElementById('smartsheet-form')
 for (const field of [sourceForm.elements.sheetId, sourceForm.elements.columns, form.elements.dataset]) field.addEventListener('input', () => {
  sourceForm.elements.consent.checked = false
  invalidate()
 })
 sourceForm.onsubmit = event => {
  event.preventDefault()
  const accessToken = sourceForm.elements.accessToken.value, confirmRead = sourceForm.elements.consent.checked
  sourceForm.elements.accessToken.value = ''; sourceForm.elements.consent.checked = false
  action(async () => {
   const datasetId = form.elements.dataset.value, sheetId = sourceForm.elements.sheetId.value
   let columns
   try { columns = JSON.parse(sourceForm.elements.columns.value) } catch { throw Error('Smartsheet column selection must be a JSON array of column ids, native names and types.') }
   if (!/^[a-z][a-z0-9-]{0,63}$/.test(datasetId)) throw Error('Enter the target dataset id above.')
   invalidate()
   const current = await load(datasetId)
   const result = await request('/api/operator/smartsheet/preview', {datasetId,sheetId,columns,accessToken,confirmRead,catchup:!!current}, datasetId)
   renderPlan(result, datasetId)
  })
 }
}
