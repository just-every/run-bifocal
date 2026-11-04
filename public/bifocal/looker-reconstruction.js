const form=document.querySelector('#looker-form')
if(form){
 const el=id=>document.getElementById('looker-'+id),field=name=>form.elements.namedItem(name),kinds=['page','data-source','field','blend','calculation','parameter','filter','layout','sharing','delivery']
 let plan,current,review
 const status=text=>el('status').textContent=text
 const request=async(path,data,headers={})=>{const r=await fetch('/api/operator/'+path,{method:data===undefined?'GET':'POST',headers:{...headers,...data===undefined?{}:{'content-type':'application/json'}},...data===undefined?{}:{body:JSON.stringify(data)}});const value=await r.json();if(!r.ok)throw Error(value.error??'Request refused');return value}
 const headers=()=>({'X-Import-Kind':'migration-project','X-Import-Dataset':field('project').value})
 const base=()=> 'migration-projects/'+field('project').value
 const run=fn=>async event=>{event?.preventDefault();try{await fn()}catch(error){status(error.message)}}
 const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node}
 function evidenceEditor(items){el('evidence').replaceChildren();for(const item of items){const group=document.createElement('fieldset');group.dataset.kind=item.kind;group.dataset.id=item.id;group.dataset.revision=item.sourceRevision;group.append(text('legend',item.kind));for(const [name,value] of [['status',item.status],['sourceLocation',item.sourceLocation],['original',item.original]]){const label=text('label',item.kind+' '+name),input=document.createElement(name==='status'?'select':name==='original'?'textarea':'input');if(name==='status')for(const state of ['inaccessible','supplied','unsupported'])input.add(new Option(state,state));input.value=value;input.setAttribute('aria-label',item.kind+' '+name);input.dataset.field=name;label.append(input);group.append(label)}el('evidence').append(group)}}
 const evidence=()=>[...el('evidence').children].map(g=>({id:g.dataset.id,kind:g.dataset.kind,sourceRevision:new Date().toISOString(),...Object.fromEntries([...g.querySelectorAll('[data-field]')].map(i=>[i.dataset.field,i.value]))}))
 function inventory(){
  el('current').hidden=false;el('guide').open=false;el('plan').hidden=true;review=null;el('preview').disabled=true;el('results').replaceChildren()
  el('inventory').replaceChildren(text('p','Inactive · sharing grants: none · delivery unavailable · source parity unproved'))
  for(const item of current.items){let state=item.source.mapping;try{if(kinds.includes(item.source.kind))state=JSON.parse(item.native).status??'invalid evidence'}catch{state='invalid evidence'}const detail=document.createElement('details');detail.append(text('summary',item.source.id+' · '+item.source.kind+' · '+state+(item.conflict?' · Source conflict':'')),text('p',item.source.gap||'Supplied owner evidence; live source parity remains unproved.'));el('inventory').append(detail)}
  el('item').replaceChildren(...current.items.map(i=>new Option(i.source.id,i.source.id)));if(current.items.some(i=>i.source.id==='native-page'))el('item').value='native-page';selectItem()
 }
 function selectItem(){const item=current.items.find(i=>i.source.id===el('item').value);el('native').value=item.native;el('keep').disabled=el('source').disabled=!item.conflict}
 el('item').onchange=selectItem
 const load=async()=>{current=await request(base());inventory();status('Retained reconstruction loaded')}
 el('start').onclick=run(async()=>{
  const source=await request('datasets/'+field('dataset').value),calendars=await request('calendars')
  const calendar=calendars.calendars?.[0]??calendars[0]
  evidenceEditor(kinds.map(kind=>({id:'evidence-'+kind,kind,sourceRevision:'owner-1',sourceLocation:field('reportUrl').value,status:'inaccessible',original:'Not supplied'})))
  field('document').value=JSON.stringify({sourceRevision:source.revision,definition:{views:[{id:'report-page',kind:'report',query:{version:1,dataset:field('dataset').value,joins:[],filters:[],groupBy:[],measures:[],context:{modelVersion:'looker-reconstruction',metricVersion:'owner-supplied',accountingBasis:'not-applicable',calendar:{id:calendar?.id??'choose-calendar',version:calendar?.version??1},rounding:'half-even'},semantic:{grain:[],dimensions:source.table.columns.map(c=>({column:c.name,type:c.type})),hierarchies:[],slowlyChanging:'reject-duplicate-grain'}},rowRules:[]}],quality:[]},parameters:[],reference:null},null,2)
  el('guide').open=true;status('Guide started. Supply every omitted definition and complete the inactive native mapping.')
 })
 el('load').onclick=run(load)
 form.onsubmit=run(async()=>{
  review=null;el('preview').disabled=true
  const originals=await Promise.all([...field('originals').files].map(async f=>{if(f.size>32768)throw Error('Original evidence exceeds 32 KiB');return {name:f.name,content:await f.text()}}))
  const input={version:1,projectId:field('project').value,source:'looker-studio',cutoff:new Date().toISOString().slice(0,19)+'Z',rollbackPlan:field('rollbackPlan').value,reportUrl:field('reportUrl').value,originals,evidence:evidence(),drafts:[{id:'native-page',sourceRevision:new Date().toISOString(),document:field('document').value}]}
  const bytes=new TextEncoder().encode(JSON.stringify(input));if(bytes.length>1048576)throw Error('Reconstruction exceeds 1 MiB')
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''),chunk=65536;let upload
  for(let index=0;index<Math.ceil(bytes.length/chunk);index++){const part=bytes.subarray(index*chunk,(index+1)*chunk),chunkHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',part))].map(x=>x.toString(16).padStart(2,'0')).join('');upload=await request('import/uploads',{...upload?{uploadId:upload.uploadId}:{},name:'owner-reconstruction.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:Math.ceil(bytes.length/chunk),index,chunkSha256:chunkHash,base64:btoa(String.fromCharCode(...part))},headers())}
  plan=await request('import/plan',{uploadId:upload.uploadId,...current?{catchup:true}:{}},headers());el('plan').hidden=false;el('plan-summary').textContent=JSON.stringify({fingerprint:plan.fingerprint,counts:plan.counts,project:plan.project},null,2);el('plan-summary').style.whiteSpace='pre-wrap';el('plan-summary').style.overflowWrap='anywhere';el('confirm').checked=false;el('apply').disabled=true;status('Review the exact reconstruction plan and every retained gap.')
 })
 el('confirm').onchange=()=>el('apply').disabled=!el('confirm').checked
 el('apply').onclick=run(async()=>{if(!el('confirm').checked)throw Error('Exact review required');for(let i=0;i<20;i++){const result=await request('import/apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},headers());if(result.job.state==='completed'){const reconciled=await request('import/reconcile',{planId:plan.planId},headers());if(!reconciled.ok)throw Error('Import reconciliation failed');await load();status('Inactive reconstruction imported; source parity remains unproved.');return}}throw Error('Resume the incomplete import')})
 el('originals').onclick=run(async()=>{const history=await request('import/history',undefined,headers()),retained=[];for(const entry of history.history.slice(0,100)){const value=await request('import/original/'+entry.planId,undefined,headers());for(const item of value.originals){if(item.original.status==='retained'){const bytes=Uint8Array.from(atob(item.original.base64),c=>c.charCodeAt(0)),input=JSON.parse(new TextDecoder().decode(bytes));retained.push({plan:entry.planId,reportUrl:input.reportUrl,originals:input.originals})}}}el('original-view').hidden=false;el('original-view').open=true;el('original-text').textContent=JSON.stringify(retained,null,2);status('Retained originals inspected.')})
 el('save').onclick=run(async()=>{current=await request(base()+'/edit',{reviewedRevision:current.revision,itemId:el('item').value,native:el('native').value});inventory();status('Inactive edit saved; review invalidated.')})
 for(const [button,choice] of [['keep','keep-native'],['source','use-source']])el(button).onclick=run(async()=>{current=await request(base()+'/resolve',{reviewedRevision:current.revision,itemId:el('item').value,choice});inventory();status('Conflict resolved; review again.')})
 function showReview(value){
  el('results').replaceChildren(text('p',value.compatible?'Native definition reviewed. Source parity and cutover remain unproved.':'Blocking reconstruction gaps remain.'))
  for(const issue of value.issues)el('results').append(text('p',issue.item+': '+issue.code+' — '+issue.location))
  for(const draft of value.drafts){el('results').append(text('h4',draft.item+' · '+draft.reconciliation));if(draft.answer){const table=document.createElement('table');table.setAttribute('aria-label','Reconstructed native values');const tbody=document.createElement('tbody');for(const row of draft.answer.rows){const tr=document.createElement('tr');for(const cell of [...row.dimensions,...Object.values(row.values).map(v=>v.value)])tr.append(text('td',cell??'NULL'));tbody.append(tr)}const tr=document.createElement('tr');tr.append(text('th','Total'));for(const v of Object.values(draft.answer.totals))tr.append(text('td',v.value??'NULL'));tbody.append(tr);table.append(tbody);el('results').append(table)}}
 }
 el('review').onclick=run(async()=>{review=await request(base()+'/review',{reviewedRevision:current.revision});showReview(review);el('preview').disabled=!review.compatible;status('Current evidence reviewed.')})
 el('preview').onclick=run(async()=>{const result=await request(base()+'/preview',{reviewedRevision:current.revision,reviewedDigest:review.digest});showReview(result);status('Exact native preview confirmed. No publication or delivery occurred.')})
 el('undo').onclick=run(async()=>{if(!plan)throw Error('Only this session’s reviewed import can be undone');await request('import/undo',{planId:plan.planId},headers());current=null;el('current').hidden=true;status('Import undone; originals remain until eligible erasure.')})
 el('erase').onclick=run(async()=>{await request(base()+'/erase',{confirmImport:el('erase-id').value,reviewedRevision:current?.revision??null});current=null;el('current').hidden=true;status('Reconstruction originals, drafts and history withdrawn.')})
}
