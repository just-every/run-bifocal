const form=document.getElementById('export-policy'),status=document.getElementById('export-policy-status')
let revision=Number(form.dataset.revision),pending=Promise.resolve()
form.addEventListener('submit',event=>event.preventDefault())
form.addEventListener('change',()=>{
 if(!form.reportValidity()){status.textContent='Not saved. Enter a whole row count within the displayed limits.';status.dataset.error='true';return}
 const values={csv:Number(form.elements.csv.value),xlsx:Number(form.elements.xlsx.value)}
 pending=pending.then(async()=>{
  status.textContent='Saving export limits…';status.dataset.error='false'
  try {
   const response=await fetch('/api/operator/explore/export-policy',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({previousRevision:revision,...values})}),result=await response.json()
   if(!response.ok)throw Error(result.error==='export_policy_changed'?'Another change was saved. Reload before trying again.':result.error?.replaceAll('_',' ')||'Export limits could not be saved.')
   revision=result.revision;form.dataset.revision=String(revision)
   status.textContent='Export limits saved.'
  }catch(error){status.textContent='Not saved. '+error.message+' Your entered values remain in these fields.';status.dataset.error='true'}
 })
})
