export function instanceControls({request,act,load,status,getRun}) {
 const $=id=>document.getElementById(id)
 let review=null
 const invalidate=()=>{review=null;$('report-instance-preview').hidden=true;$('report-instance-confirm').checked=false;$('report-instance-save').disabled=true}
 const render=run=>{
  const owner=run?.access.kind==='owner'&&!run.access.readOnly
  $('report-instance-tools').hidden=!owner
  $('report-instance-form').hidden=!['rendered','approved'].includes(run?.state)
  $('report-instance-state').textContent=run?.instanceApproval?'Recorded instance approval expires '+run.instanceApproval.expiresAt+'. Current authority and all reviewed bindings are checked again before submission.':''
 }
 $('report-instance-form').oninput=invalidate
 $('report-instance-form').onsubmit=event=>{event.preventDefault();act(async()=>{
  invalidate();const run=getRun(),expiry=new Date($('report-instance-expiry').value)
  if(!Number.isFinite(expiry.getTime()))throw Error('Choose an exact future approval expiry.')
  review=await request('/api/operator/report-runs/'+run.id+'/review','POST',{expiresAt:expiry.toISOString()})
  $('report-instance-context').textContent=JSON.stringify(review.context,null,2)
  $('report-instance-preview').hidden=false;status('Review the exact retained artifact and approval context, then confirm.')
 })}
 $('report-instance-confirm').onchange=()=>{$('report-instance-save').disabled=!review||!$('report-instance-confirm').checked}
 $('report-instance-save').onclick=()=>act(async()=>{
  if(!review||!$('report-instance-confirm').checked)throw Error('Review and confirm the exact instance first.')
  const run=getRun(),saved=review
  await request('/api/operator/report-runs/'+run.id+'/approve','POST',{reviewId:saved.id,digest:saved.context.digest,previousVersion:saved.previousVersion})
  await load();status('The exact report instance was approved. Access and delivery still require their existing authority.')
 })
 return {invalidate,render}
}
