// Use the existing file door's busy state, review and exact Apply controls.
export function connectHubspot({action, load, call, request, renderPlan, datasetInput}) {
 const form = document.getElementById('hubspot-form')
 form.addEventListener('input', () => { form.elements.consent.checked = false })
 // Checkbox input itself must remain checkable after the reviewed fields settle.
 form.elements.consent.addEventListener('input', event => event.stopPropagation())
 form.onsubmit = event => {
  event.preventDefault()
  action(async () => {
   const dataset = datasetInput.value
   if (!/^[a-z][a-z0-9-]{0,63}$/.test(dataset)) throw Error('Enter the dataset id above before reading HubSpot.')
   const values = Object.fromEntries(new FormData(form)), confirmRead = form.elements.consent.checked
   delete values.consent
   form.elements.accessToken.value = ''; form.elements.consent.checked = false
   await load(dataset)
   const history = await call('history', undefined, dataset)
   const plan = await request('/api/operator/analytics/hubspot/preview', {...values, datasetId: dataset, confirmRead, catchup: history.history.length > 0}, dataset)
   renderPlan(plan, dataset)
  })
 }
}
