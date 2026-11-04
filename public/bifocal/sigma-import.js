import {figure} from './format.js'
import {upload} from './file-upload.js'
import {element,metadata,table} from './file-view.js'
const $=id=>document.getElementById(id),form=$('sigma-form')
if(form){
 let plan=null,pendingPlan=null,current=null,projectId='',busy=false
 const status=value=>{$('status').textContent=value}
 const call=async(action,data)=>request('/api/operator/import/'+action,data,{'X-Import-Kind':'sigma-workbook','X-Import-Dataset':projectId})
 const request=async(path,data,extra={})=>{
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'content-type':'application'+'/'+'json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),value=await response.json()
  if(!response.ok)throw Error(value.reason??value.error)
  return value
 }
 const action=work=>async event=>{event?.preventDefault();if(busy)return;busy=true;try{await work()}catch(error){status('Sigma import refused: '+error.message)}finally{busy=false;$('sigma-apply').disabled=!plan||!!plan.counts.rejected||!$('sigma-confirm').checked}}
 const invalidate=()=>{plan=null;$('sigma-confirm').checked=false;$('sigma-review').hidden=true;$('sigma-apply').disabled=true}
 form.addEventListener('input',invalidate)
 function report(box,project,fingerprint){
  box.replaceChildren()
  if(!project?.sigma){box.append(element('p','No Sigma inventory was accepted. Inspect the validation errors.'));return}
  const sigma=project.sigma
  box.append(metadata([['Project',project.id],['State','Inactive · owner only · no source writes'],['Workbook',sigma.document.workbookId??'Absent evidence'],['Document version',sigma.document.documentVersion??'Absent evidence'],['Published version',sigma.document.latestVersion??'Absent evidence'],['Schema',sigma.schema.schemaVersion+' · beta'],['Compatibility profile',sigma.schema.apiVersion],...(fingerprint?[['Fingerprint',fingerprint]]:[])]))
  box.append(table('Sigma element inventory',['Stable item','Kind','Source revision','State'],project.items.map(i=>[i.source.id,i.source.kind,i.source.sourceRevision,i.conflict?'Native conflict':i.edited?'Native edit':'Inactive original'])))
  box.append(table('Sigma page membership',['Page ID','Element IDs'],Object.entries(sigma.pageElements).map(([id,items])=>[id,items.join(', ')])))
  const problems=[...sigma.issues,...sigma.drafts.flatMap(d=>d.issues)]
  if(problems.length)box.append(table('Sigma unresolved evidence',['Location','Classification','Reason'],problems.map(i=>[i.location,i.code,i.reason])))
  const detail=element('details'),summary=element('summary','Inspect original code and native draft definitions'),pre=element('pre',JSON.stringify(sigma,null,2));pre.tabIndex=0;pre.setAttribute('aria-label','Sigma source and native definitions');detail.append(summary,pre);box.append(detail)
 }
 async function load(){current=null;$('sigma-current').replaceChildren();current=await request('/api/operator/migration-projects/'+projectId);renderCurrent();return current}
 function renderCurrent(){
  const box=$('sigma-current');report(box,current)
  if(!current?.sigma)return
  for(const draft of current.sigma.drafts){
   const region=element('section'),title=element('h3','Native draft · '+draft.element),result=element('div'),preview=element('button','Review native preview'),save=element('button','Save reviewed native draft')
   preview.type=save.type='button';save.disabled=true
   let review=null
   const input=()=>({document:JSON.stringify(draft.definition),migrationProject:projectId,migrationRevision:current.revision,migrationElement:draft.element})
   preview.disabled=!draft.definition||draft.issues.length>0||current.items.some(i=>i.conflict)||!!current.items.find(i=>i.source.id===draft.itemId)?.edited
   preview.addEventListener('click',action(async()=>{
    review=await request('/api/operator/model-authoring/review',input());result.replaceChildren()
    for(const impact of review.impacts){
     if(impact.answer){const a=impact.answer;result.append(table('Sigma native values',['Group',...draft.definition.views[0].query.measures.map(m=>m.id)],a.rows.map(row=>[row.dimensions.map(v=>v===null?'null':String(v)).join(', ')||'All rows',...draft.definition.views[0].query.measures.map(m=>row.values[m.id].value===null?row.values[m.id].state:figure(row.values[m.id].value,row.values[m.id].unit,impact.currency))])));result.append(table('Sigma native totals',['Measure','Value','Unit','Nulls'],Object.entries(a.totals).map(([id,v])=>[id,v.value===null?v.state:figure(v.value,v.unit,impact.currency),v.unit==='money'?impact.currency:v.unit,v.nulls])))}else result.append(element('p',impact.error))
    }
    save.disabled=!review.compatible;status(review.compatible?'Sigma native preview reviewed; source writes 0.':'Sigma native preview refused.')
   }))
   save.addEventListener('click',action(async()=>{if(!review)return;const created=await request('/api/operator/model-authoring/create',{...input(),reviewedDigest:review.digest});result.append(element('p','Inactive native draft saved: '+created.modelId));const link=element('a','Open native model draft');link.href='/app/models?model='+encodeURIComponent(created.modelId);result.append(link);save.disabled=true;status('Sigma native draft saved without publication.')}))
   const controls=element('div',undefined,'actions');controls.append(preview,save);region.append(title,controls,result);box.append(region)
  }
  const versions=element('details');versions.append(element('summary','Migration versions and originals'))
  for(const entry of current.history){const button=element('button','Inspect '+entry.action+' version '+entry.revision.slice(0,12));button.type='button';button.addEventListener('click',action(async()=>{const version=await request('/api/operator/migration-projects/'+projectId+'/versions/'+entry.revision),pre=element('pre',JSON.stringify(version,null,2));pre.tabIndex=0;versions.append(pre);status('Sigma retained version loaded.')}));versions.append(button)}
  box.append(versions)
  call('history').then(({history})=>{for(const entry of history){
   const row=element('div',undefined,'actions'),original=element('button','Inspect original '+entry.planId.slice(0,8)),undo=element('button','Undo Sigma import '+entry.planId.slice(0,8));original.type=undo.type='button'
   original.addEventListener('click',action(async()=>{const retained=await call('original/'+entry.planId),pre=element('pre',JSON.stringify(retained,null,2));pre.tabIndex=0;row.append(pre);status('Sigma original custody loaded.')}))
   undo.addEventListener('click',action(async()=>{await call('undo',{planId:entry.planId});current=null;box.replaceChildren(element('p','Sigma import undone. Original custody remains until eligible erasure.'));status('Sigma import undone.')}))
   row.append(original,undo);versions.append(row)
  }}).catch(error=>status('Sigma history unavailable: '+error.message))
 }
 form.addEventListener('submit',action(async()=>{
  if(pendingPlan){await call('undo',{planId:pendingPlan});pendingPlan=null}
  invalidate();projectId=form.elements.project.value
  const file=form.elements.code.files[0];if(!file||file.size>48000)throw Error('Choose a bounded original JSON or YAML code file.')
  const input={version:1,projectId,source:'sigma',cutoff:form.elements.cutoff.value,rollbackPlan:form.elements.rollback.value,sigma:{filename:file.name,content:await file.text()},reconstruction:JSON.parse(form.elements.reconstruction.value)}
  const uploadId=await upload(input,call,status,projectId,{maxBytes:65536,chunkBytes:65536})
  const history=await call('history');plan=await call('plan',{uploadId,...(history.history.length?{catchup:true}:{})});pendingPlan=plan.planId;report($('sigma-plan'),plan.project,plan.fingerprint);$('sigma-review').hidden=false;status(plan.counts.rejected?'Sigma source document rejected.':'Sigma inactive plan ready for exact approval.')
 }))
 $('sigma-load').addEventListener('click',action(async()=>{invalidate();projectId=form.elements.project.value;await load();status('Sigma project loaded.')}))
 $('sigma-confirm').addEventListener('change',()=>{$('sigma-apply').disabled=!plan||!!plan.counts.rejected||!$('sigma-confirm').checked})
 $('sigma-cancel').addEventListener('click',action(async()=>{if(pendingPlan)await call('undo',{planId:pendingPlan});pendingPlan=null;invalidate();status('Sigma review cancelled.')}))
 $('sigma-apply').addEventListener('click',action(async()=>{
  if(!plan||!$('sigma-confirm').checked)return
  let completed=false
  for(let i=0;i<20;i++){const value=await call('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(value.job.state==='completed'){completed=true;break}}
  if(!completed)throw Error('Apply is incomplete; reload the retained plan before continuing.')
  const reconciliation=await call('reconcile',{planId:plan.planId});if(!reconciliation.ok)throw Error('Reconciliation differs; inspect current state before continuing.')
  await load();pendingPlan=null;invalidate();status('Sigma import applied and reconciled; all source actions remain inactive.')
 }))
 $('sigma-erase').addEventListener('click',action(async()=>{projectId=form.elements.project.value;if($('sigma-erase-id').value!==projectId)throw Error('Type the exact project ID.');await request('/api/operator/migration-projects/'+projectId+'/erase',{confirmImport:projectId,reviewedRevision:current?.revision??null});current=null;invalidate();$('sigma-current').replaceChildren();status('Sigma project, originals, history and derived drafts erased.')}))
}
