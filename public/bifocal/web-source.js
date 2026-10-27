/** Web reads use the existing review, apply, reconcile, history and Undo UI. */
export function attachWebSource({action,request,call,load,renderPlan,status,dataset}) {
 const form=document.getElementById('web-source-form'),cancel=document.getElementById('web-source-cancel')
 let active
 request('/api/operator/web-source/config',undefined,'').then(config=>{
  document.getElementById('web-source-configuration').textContent=config.origins.length?'Approved origins: '+config.origins.join(', '):'No source origin approved. The installation administrator must configure BIFOCAL_WEB_SOURCE_ORIGINS before a read.'
 }).catch(error=>{document.getElementById('web-source-configuration').textContent=error.message})
 form.onsubmit=event=>{event.preventDefault();action(async()=>{
  const id=dataset()
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw Error('Enter the dataset id above before reading a web source.')
  const values=Object.fromEntries(new FormData(form)),accessToken=values.accessToken
  form.elements.accessToken.value=''
  const fields=JSON.parse(values.fields),readId=crypto.randomUUID()
  await load(id)
  const history=await call('history',undefined,id)
  const input={datasetId:id,readId,endpoint:values.endpoint,format:values.format,itemsPath:values.itemsPath,fields,paging:values.paging,nextPath:values.nextPath,parameter:values.parameter,sizeParameter:values.sizeParameter,pageSize:Number(values.pageSize),accessToken,confirmRead:form.elements.consent.checked,confirmSnapshot:form.elements.snapshotConsent.checked,catchup:history.history.length>0}
  active={datasetId:id,readId,cancelled:false};cancel.disabled=false
  status('Reading the complete web snapshot…')
  try {
   const result=await request('/api/operator/web-source/preview',input,id)
   if(active.cancelled)throw Error('Source read cancelled; no dataset was applied.')
   renderPlan(result,id)
  } finally {
   active=null;cancel.disabled=true;cancel.dataset.previousDisabled='true';input.accessToken=''
   form.elements.consent.checked=false;form.elements.snapshotConsent.checked=false
  }
 })}
 cancel.onclick=async()=>{
  if(!active)return
  cancel.disabled=true
  try {await request('/api/operator/web-source/cancel',{datasetId:active.datasetId,readId:active.readId},active.datasetId);if(active)active.cancelled=true;status('Cancellation requested. Waiting for the current bounded page to finish…')}
  catch(error){status(error.message,true);cancel.disabled=false}
 }
}
