const endpoint='/api/operator/approval-classifications'
const status=document.querySelector('#classification-status'),peopleList=document.querySelector('#classification-people')
const form=document.querySelector('#classification-form'),personSelect=document.querySelector('#classification-person'),kindSelect=document.querySelector('#classification-kind'),expiry=document.querySelector('#classification-expiry'),save=document.querySelector('#classification-save'),review=document.querySelector('#classification-review')
let people=[]
const labels={none:'None',leadership:'Leadership',board:'Board'}
const selected=()=>people.find(person=>person.operatorId===personSelect.value)
const localTime=value=>{
 const date=new Date(value),shifted=new Date(date.getTime()-date.getTimezoneOffset()*60000)
 return shifted.toISOString().slice(0,19)
}
const message=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error)}
async function api(path='',options={}) {
 const response=await fetch(endpoint+path,{...options,credentials:'same-origin',headers:{'content-type':'application/json',...options.headers}})
 const data=await response.json()
 if(!response.ok)throw new Error(data.error??'classification_request_failed')
 return data
}
function updateExpiry() {expiry.disabled=kindSelect.value==='none';expiry.required=!expiry.disabled}
function choose() {
 const person=selected()
 save.disabled=!person
 if(!person)return
 kindSelect.value=person.kind
 expiry.value=person.expiresAt?localTime(person.expiresAt):''
 updateExpiry()
 review.textContent=`Reviewing ${person.displayName}, membership version ${person.operatorVersion}, classification revision ${person.revision}. Saving records this exact choice in the audit history.`
}
async function load(preferred=personSelect.value) {
 const [data,audit]=await Promise.all([api(),api('/audit')])
 const history=document.querySelector('#classification-history');history.replaceChildren()
 for(const record of audit.records){const p=document.createElement('p');p.textContent=`${record.recordedAt} · ${record.operatorId} · ${record.before.kind} revision ${record.before.revision} → ${record.after.kind} revision ${record.after.revision} · By ${record.actorId}`;history.append(p)}
 people=data.people
 peopleList.replaceChildren()
 personSelect.replaceChildren()
 const list=document.createElement('ul')
 for(const person of people) {
  const option=document.createElement('option')
  option.value=person.operatorId;option.textContent=`${person.displayName} (${person.email})`;personSelect.append(option)
  const item=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('p')
  name.textContent=person.displayName
  detail.textContent=`${person.email} · ${labels[person.kind]} · Revision ${person.revision}${person.expiresAt?` · Expires ${new Date(person.expiresAt).toLocaleString()}`:''}${person.current?'':' · Expired or membership changed; fresh review required'}`
  item.append(name,detail);list.append(item)
 }
 if(people.length)peopleList.append(list)
 else peopleList.textContent='No active people are available.'
 personSelect.disabled=!people.length
 if(people.some(person=>person.operatorId===preferred))personSelect.value=preferred
 choose()
}
personSelect.addEventListener('change',choose)
kindSelect.addEventListener('change',updateExpiry)
form.addEventListener('submit',async event=>{
 event.preventDefault()
 const person=selected()
 if(!person)return
 save.disabled=true
 try {
  const expiresAt=kindSelect.value==='none'?null:new Date(expiry.value).toISOString()
  await api('/'+person.operatorId,{method:'PUT',body:JSON.stringify({previousRevision:person.revision,operatorVersion:person.operatorVersion,kind:kindSelect.value,expiresAt})})
  await load(person.operatorId)
  message('The reviewed classification is saved. It grants no data access or approval authority.')
 } catch(error) {
  message(`Classification was not saved: ${error.message.replaceAll('_',' ')}. Review the current person and expiry before trying again.`,true)
  try {await load(person.operatorId)}catch{save.disabled=true}
 } finally {if(selected())save.disabled=false}
})
load().then(()=>message('Choose an active person and review their classification.')).catch(error=>message(`Classifications are unavailable: ${error.message.replaceAll('_',' ')}.`,true))
