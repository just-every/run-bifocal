// Share the existing file door's busy state, review and exact Apply flow.
export function stripeRead({action,load,request,renderPlan,form}) {
 const source=document.getElementById('stripe-form')
 source.onsubmit=event=>{
  event.preventDefault()
  action(async()=>{
   const dataset=form.elements.dataset.value
   if(!/^[a-z][a-z0-9-]{0,63}$/.test(dataset))throw Error('Enter the dataset id above before reading a source.')
   const accessToken=source.elements.accessToken.value,confirmRead=source.elements.consent.checked
   source.elements.accessToken.value='';source.elements.consent.checked=false
   const values=Object.fromEntries(new FormData(source));delete values.consent;delete values.accessToken
   const current=await load(dataset)
   renderPlan(await request('/api/operator/analytics/stripe/preview',{...values,accessToken,datasetId:dataset,confirmRead,catchup:!!current},dataset),dataset)
  })
 }
}
