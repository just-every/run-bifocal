const readErrors={
 web_credential_in_response:'The source response includes authorization data. Remove that data before importing.',
 web_read_cancelled:'Source read cancelled.',
 web_nonterminating_pagination:'The source did not finish paging. Check its continuation settings before another read.',
 web_rate_limited:'The source rate limit stopped this read. Wait until the source allows another request.',
 web_authorization_expired:'Source authorization expired or was refused. Authorize a new read.',
 web_destination_not_approved:'Choose an endpoint on an approved source origin.',
 public_https_origin_required:'Choose an approved public HTTPS source.',
 web_redirect_refused:'The source redirected this read. Enter its approved read endpoint directly.',
 web_missing_path:'The response does not match the configured row or column paths.',
 web_partial_response_refused:'The source returned only part of a response. A complete snapshot is required.',
 web_response_limit:'The complete source response exceeds the read limit.',
 web_read_time_limit:'The source did not finish within the read time limit.'
}
const readableError=error=>Object.hasOwn(readErrors,error.message)?new Error(readErrors[error.message],{cause:error}):error

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
  } catch(error){throw readableError(error)} finally {
   active=null;cancel.disabled=true;cancel.dataset.previousDisabled='true';input.accessToken=''
   form.elements.consent.checked=false;form.elements.snapshotConsent.checked=false
  }
 })}
 cancel.onclick=async()=>{
  if(!active)return
  cancel.disabled=true
  try {await request('/api/operator/web-source/cancel',{datasetId:active.datasetId,readId:active.readId},active.datasetId);if(active)active.cancelled=true;status('Cancellation requested. Waiting for the current bounded page to finish…')}
  catch(error){status(readableError(error).message,true);cancel.disabled=false}
 }
}
