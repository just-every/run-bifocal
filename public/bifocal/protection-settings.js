const $ = id => document.getElementById(id)
async function api(path, method='GET', data) {
 const response=await fetch(path,{method,headers: data ? {'Content-Type':'application/json'} : {},...(data?{body:JSON.stringify(data)}:{})})
 const value=await response.json()
 if(!response.ok)throw new Error((value.error||'Request refused')+'. '+(value.recovery||'Review the current state again. No automatic retry occurred.'))
 return value
}
const decimal=value=>{
 if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value))throw new Error('Enter a nonnegative USD amount with at most six decimal places.')
 const [whole,fraction='']=value.split('.')
 const micro=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))
 if(micro>1000000000000n)throw new Error('USD amount exceeds the supported limit of 1000000.')
 return Number(micro)
}
const usd=value=>{const n=BigInt(value);return `${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`}
function describe(id,values){const list=document.createElement('dl');list.className='facts-grid';for(const [label,value]of values){const item=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);item.append(dt,dd);list.append(item)}$(id).replaceChildren(list)}
function bind(id,status,run){$(id).addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$(status).dataset.error='false';try{await run(new FormData(event.target))}catch(error){$(status).textContent=error.message;$(status).dataset.error='true'}finally{button.disabled=false}})}
function renderProtectionHistory(records){
 const root=$('protection-history'),title=document.createElement('h3'),scope=document.createElement('p')
 title.textContent='Protection history';scope.textContent=records.scope;root.replaceChildren(title,scope)
 if(!records.history.length){const empty=document.createElement('p');empty.textContent='No retained forward protection reviews.';root.append(empty)}
 for(const entry of [...records.history].reverse()){
  const item=document.createElement('details'),heading=document.createElement('summary'),facts=document.createElement('dl');facts.className='facts-grid';item.open=entry===records.history.at(-1)
  heading.textContent=entry.recorded_at+' — policy '+entry.replacement_revision
  const values=[['Approving owner reference',entry.approving_owner_id],['Owner authority version',entry.approving_owner_version],['Approved at (UTC)',entry.recorded_at],['Reviewed dataset',entry.dataset_id],['Reviewed source state',entry.source_state],['Reviewed source revision',entry.source_revision??'No published revision'],['Previous policy revision',entry.previous_revision??'No previous policy'],['Replacement policy revision',entry.replacement_revision],['Previous legal hold',entry.before_legal_hold===null?'No previous policy':entry.before_legal_hold?'Active':'None'],['Previous minimum date (UTC)',entry.before_minimum_retain_until??'None'],['Replacement legal hold',entry.after_legal_hold?'Active':'None'],['Replacement minimum date (UTC)',entry.after_minimum_retain_until??'None'],['Replacement acknowledged',entry.release_acknowledged?'Yes':'No'],['Audit reference',entry.audit_id]]
  for(const [label,value] of values){const group=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);group.append(dt,dd);facts.append(group)}
  item.append(heading,facts);root.append(item)
 }
}
let protection=null,budget=null
const invalidateProtection=()=>{protection=null;$('protection-save').hidden=true;$('protection-state').replaceChildren();$('protection-history').replaceChildren();$('protection-status').textContent='Source changed. Review again.'}
$('protection-review').elements.dataset.addEventListener('input',invalidateProtection)
bind('protection-review','protection-status',async data=>{
 invalidateProtection()
 const dataset=data.get('dataset'),path='/api/operator/retention/'+encodeURIComponent(dataset)
 const [value,records]=await Promise.all([api(path),api(path+'/history')])
 if($('protection-review').elements.dataset.value!==dataset)return
 protection=value
 renderProtectionHistory(records)
 describe('protection-state',[['Dataset',dataset],['Published source revision',value.reviewedDatasetRevision??'No published revision'],['Policy revision',value.policy?.revision??'No protection policy'],['Current legal hold',value.policy?.legal_hold?'Active':'None'],['Current minimum date (UTC)',value.policy?.minimum_retain_until??'None']])
 const form=$('protection-save');form.reset();form.elements.legalHold.checked=!!value.policy?.legal_hold;form.elements.until.value=value.policy?.minimum_retain_until??'';form.hidden=false
 $('protection-status').textContent='Source protection loaded. Review the exact state before saving.'
})
bind('protection-save','protection-status',async data=>{
 if(!protection)throw new Error('Review the source again.')
 const review=protection
 if((review.policy?.legal_hold||review.policy?.minimum_retain_until)&&!data.has('releaseHold'))throw new Error('Explicit acknowledgment is required to replace existing protection.')
 const value=await api('/api/operator/retention/'+encodeURIComponent(review.dataset),'PUT',{confirmDataset:review.dataset,reviewedDatasetRevision:review.reviewedDatasetRevision,previousRevision:review.policy?.revision??null,legalHold:data.has('legalHold'),minimumRetainUntil:data.get('until')||null,releaseHold:data.has('releaseHold')})
 invalidateProtection();$('protection-status').textContent='Protection saved. Policy revision '+value.revision+'. No erasure or outbound deletion was performed. Review again before another change.'
})
const invalidateBudget=()=>{budget=null;$('budget-save').hidden=true;$('budget-state').replaceChildren();$('budget-status').textContent='Budget selection changed. Review again.'}
for(const name of ['scope','id'])$('budget-review').elements[name].addEventListener('input',invalidateBudget)
bind('budget-review','budget-status',async data=>{
 invalidateBudget()
 const scope=data.get('scope'),id=data.get('id'),value=await api('/api/operator/costs/budgets')
 if($('budget-review').elements.scope.value!==scope||$('budget-review').elements.id.value!==id)return
 const row=value.budgets.find(row=>row.scope===scope&&row.id===id)
 budget={scope,id,revision:row?.revision??null}
 describe('budget-state',[['Scope',scope],['Budget',id],['Revision',budget.revision??'New budget'],['Cumulative committed USD',usd(row?.committed_micro??0)]])
 const form=$('budget-save');form.reset();form.elements.limit.value=usd(row?.limit_micro??0);form.elements.warn.value=usd(row?.warn_micro??0);form.hidden=false
 $('budget-status').textContent='USD budget loaded. Review the exact state before saving.'
})
bind('budget-save','budget-status',async data=>{
 if(!budget)throw new Error('Review the budget again.')
 const limit=decimal(data.get('limit')),warn=decimal(data.get('warn'))
 if(warn>limit)throw new Error('Warning threshold must not exceed the budget limit.')
 const value=await api('/api/operator/costs/budgets','PUT',{scope:budget.scope,id:budget.id,previousRevision:budget.revision,limitMicroUsd:limit,warnMicroUsd:warn})
 invalidateBudget();$('budget-status').textContent='USD budget saved. Revision '+value.revision+'. No work was started. Review again before another change.'
})
