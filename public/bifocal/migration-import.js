import { element, metadata, table } from './file-view.js'
const $=id=>document.getElementById(id),form=$('hex-import-form')
let plan,current,reviewedId,busy=false
const status=text=>{$('hex-status').textContent=text}
const id=()=>form.elements.project.value
async function request(path,data,expected404=false){
 const response=await fetch('/api/operator/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application'+'/json','X-Import-Kind':'migration-project','X-Import-Dataset':id()},...(data===undefined?{}:{body:JSON.stringify(data)})}),value=await response.json()
 if(expected404&&response.status===404)return null
 if(!response.ok)throw Error([value.error,value.details?.location,value.details?.reason,value.reason].filter(Boolean).join(': '))
 return value
}
const door=(action,data)=>request('import/'+action,data)
const resource=(action='',data,optional=false)=>request('migration-projects/'+id()+action,data,optional)
function approve(){ $('hex-apply').disabled=busy||!plan||!!plan.counts.rejected||!$('hex-approve').checked }
async function action(work){if(busy)return;busy=true;approve();try{await work()}catch(error){status(error.message)}finally{busy=false;approve()}}
function inventory(project){
 const node=element('div'),hex=project?.hex
 if(!hex){node.append(element('p','No original Hex inventory is retained.'));return node}
 node.append(metadata([['Original file',hex.filename],['Original SHA-256',hex.sha256],['Hex schema',hex.schema.version+' · '+hex.schema.sha256],['Source project',hex.projectId],['Source version',hex.sourceVersionId],['Execution',hex.execution],['Dependencies',hex.dependencies],['Stored outputs',hex.outputs]]))
 const schema=element('a','Published Hex format schema');schema.href=hex.schema.url;schema.rel='noreferrer';node.append(schema)
 node.append(table('Ordered original cells',['Order','Stable cell ID','Type','Source definition'],hex.cellOrder.map((cellId,index)=>{const entry=project.items.find(item=>item.source.id==='cell-'+cellId.toLowerCase()),definition=entry?JSON.parse(entry.source.original):{};return [index+1,cellId,definition.cellType??'Missing',entry?.source.original??'Missing definition']})))
 node.append(table('App cell references',['Source location','Referenced cell'],hex.layoutReferences.map(ref=>[ref.location,ref.cellId])))
 node.append(table('Unresolved reconstruction tasks',['Source location','Issue','Concrete remediation'],hex.issues.map(issue=>[issue.location,issue.code,issue.remediation])))
 node.append(table('Native reconstruction and conflicts',['Item','Native definition','Incoming conflict'],project.items.map(item=>[item.source.id,item.native,item.conflict?.original??'None'])))
 return node
}
function reset(){plan=null;current=null;reviewedId=null;$('hex-review').hidden=true;$('hex-approve').checked=false;$('hex-current-value').replaceChildren();$('hex-history').replaceChildren();$('hex-edit').hidden=true;approve()}
form.elements.project.addEventListener('input',reset)
async function load(){
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(id()))throw Error('Enter a valid migration project ID.')
 current=await resource('',undefined,true);reviewedId=id()
 $('hex-current-value').replaceChildren(current?inventory(current):element('p','No current migration project. Retained imports remain erasable.'))
 $('hex-edit').hidden=!current
 const select=$('hex-edit').elements.namedItem('item');select.replaceChildren(...(current?.items??[]).map(item=>{const option=element('option',item.source.id);option.value=item.source.id;return option}));select.onchange=()=>{$('hex-edit').elements.native.value=current?.items.find(item=>item.source.id===select.value)?.native??''};select.onchange()
 const history=await door('history');$('hex-history').replaceChildren(element('h3','Migration import history'))
 for(const entry of history.history){
  const row=element('div',undefined,'panel');row.append(element('p',entry.state+' · '+entry.planId))
  if(entry.state==='completed'){
   const original=element('button','Download Hex original');original.type='button';original.onclick=()=>action(async()=>{
    const retained=await door('original/'+entry.planId),raw=retained.originals[0]?.original
    if(raw?.status==='unavailable'||!raw?.base64)throw Error('Original unavailable after erasure or refusal.')
    const envelope=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw.base64),c=>c.charCodeAt(0))))
    const bytes=Uint8Array.from(atob(envelope.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application'+'/octet-stream'})),link=element('a');link.href=url;link.download=envelope.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
   });row.append(original)
   const undo=element('button','Undo Hex import');undo.type='button';undo.onclick=()=>action(async()=>{await door('undo',{planId:entry.planId});await load();status('Hex import undone. Exact prior inventory restored; originals remain erasable.')});row.append(undo)
  }
  $('hex-history').append(row)
 }
 if(current?.history.length)$('hex-history').append(table('Native version history',['Revision','Action'],current.history.map(entry=>[entry.revision,entry.action])))
}
form.onsubmit=event=>{event.preventDefault();action(async()=>{
 plan=null;approve();$('hex-review').hidden=true
 const file=form.elements.file.files[0];if(!file||file.size>262144)throw Error('Choose a Hex file of at most 256 KiB.')
 const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte)
 const input={version:1,projectId:id(),source:'hex',format:'hex-yaml',filename:file.name,base64:btoa(raw),cutoff:form.elements.cutoff.value,rollbackPlan:form.elements.rollback.value},payload=new TextEncoder().encode(JSON.stringify(input))
 const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join(''),hash=await digest(payload),totalChunks=Math.ceil(payload.length/65536)
 let upload
 try{
  for(let index=0;index<totalChunks;index++){const chunk=payload.slice(index*65536,(index+1)*65536);let raw='';for(const byte of chunk)raw+=String.fromCharCode(byte);upload=await door('uploads',{...(upload?{uploadId:upload.uploadId}:{}),name:'hex-project.json',bundleSha256:hash,totalBytes:payload.length,totalChunks,index,chunkSha256:await digest(chunk),base64:btoa(raw)})}
  const history=await door('history')
  plan=await door('plan',{uploadId:upload.uploadId,...(history.history.some(entry=>entry.state==='completed')?{catchup:true}:{})})
 }catch(error){form.elements.file.value='';throw error}
 $('hex-plan').replaceChildren(metadata([['Reviewed fingerprint',plan.fingerprint],['Plan ID',plan.planId]]),inventory(plan.project));$('hex-review').hidden=false;$('hex-approve').checked=false
 status(plan.counts.rejected?'Hex review refused. Correct the source inventory.':'Hex review ready. Resolve the listed tasks before claiming migration parity.');$('hex-review').scrollIntoView({block:'start'})
})}
$('hex-approve').onchange=approve
$('hex-load').onclick=()=>action(async()=>{await load();status('Migration project loaded.')})
$('hex-apply').onclick=()=>action(async()=>{
 if(!plan||!$('hex-approve').checked||plan.counts.rejected)throw Error('Review this exact inactive inventory first.')
 let completed=false
 for(let i=0;i<20;i++){const result=await door('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(result.job.state==='completed'){completed=true;break}}
 if(!completed)throw Error('Import remains in progress. Resume the same reviewed plan.')
 if(!(await door('reconcile',{planId:plan.planId})).ok)throw Error('Inventory reconciliation failed.')
 await load();plan=null;$('hex-review').hidden=true;$('hex-approve').checked=false;status('Hex inventory applied and reconciled. Everything remains inactive.')
})
$('hex-cancel').onclick=()=>action(async()=>{if(plan)await door('undo',{planId:plan.planId});plan=null;$('hex-review').hidden=true;status('Hex review cancelled.')})
$('hex-edit').onsubmit=event=>{event.preventDefault();action(async()=>{if(!current||reviewedId!==id())throw Error('Load the current migration project.');await resource('/edit',{reviewedRevision:current.revision,itemId:$('hex-edit').elements.namedItem('item').value,native:$('hex-edit').elements.native.value});await load();status('Inactive native reconstruction saved.')})}
for(const [button,choice]of [['hex-keep','keep-native'],['hex-source','use-source']])$(button).onclick=()=>action(async()=>{if(!current)throw Error('Load the current migration project.');await resource('/resolve',{reviewedRevision:current.revision,itemId:$('hex-edit').elements.namedItem('item').value,choice});await load();status('Reviewed conflict resolved.')})
$('hex-erase').onclick=()=>action(async()=>{if(reviewedId!==id()||$('hex-erase-id').value!==id())throw Error('Load this project and type its exact ID.');await resource('/erase',{reviewedRevision:current?.revision??null,confirmImport:id()});reset();form.elements.file.value='';$('hex-erase-id').value='';status('Migration project, originals and reconstruction history erased. This ID is retired.')})
