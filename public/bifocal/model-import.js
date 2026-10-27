import {showPreparationImports,preparationImportActions} from './model-import-preparation.js'
import {upload} from './file-upload.js'
import {element,metadata,table} from './file-view.js'
const $=id=>document.getElementById(id),form=$('model-import-form')
if(form){
 let plan=null,current=null,projectId=null,busy=false
 const status=text=>{$('status').textContent=text}
 function showReport(box,project,fingerprint){
  box.replaceChildren()
  if(!project){box.append(element('p','The project could not be translated. Inspect its plan errors.'));return}
  const report=project.report
  box.append(metadata([['Compatibility',report.compatible?(project.preparation?'Native draft mapping; source equivalence pending':'Compatible translation'):'Unresolved source semantics'],['Source language',project.input.format],['Original files',project.input.files.map(f=>f.path).join(', ')],['Unresolved items',report.issues.length],...(fingerprint?[['Reviewed fingerprint',fingerprint]]:[])]))
  if(!project.preparation)box.append(table('Source measure translations',['Source measure','Source expression','Native measure','Aggregation'],report.translations.map(t=>[t.sourceObject,t.sourceExpression,t.view+'.'+t.measure.id,t.measure.op+' '+(t.measure.column??'rows')+' · '+t.measure.unit])))
  if(!project.preparation&&report.project.resources?.length)box.append(table('Source project inventory',['Source object','Kind','Dependencies'],report.project.resources.map(r=>[r.id,r.kind,r.dependencies.join(', ')])))
  if(report.issues.length)box.append(table('Unresolved source semantics',['Source object','Reason','Required work'],report.issues.map(i=>[i.object,i.code,i.message])))
  showPreparationImports(box,project)
  const details=element('details'),summary=element('summary','Full source compatibility report'),pre=element('pre',JSON.stringify({report,definition:project.definition},null,2));details.append(summary,pre);box.append(details)
 }
 const call=async(action,data,id=projectId)=>{const r=await fetch('/api/operator/import/'+action,{method:data===undefined?'GET':'POST',headers:{'content-type':'application'+'/'+'json','X-Import-Kind':'model','X-Import-Dataset':id},...(data===undefined?{}:{body:JSON.stringify(data)})});const v=await r.json();if(!r.ok)throw Error(v.reason??v.error);return v}
 const perform=work=>async event=>{event?.preventDefault();if(busy)return;busy=true;try{await work()}catch(error){status('Semantic import unavailable: '+error.message)}finally{busy=false;$('model-import-apply').disabled=!plan||!!plan.counts.rejected||!$('model-import-confirm').checked}}
 const invalidate=()=>{plan=null;$('model-import-confirm').checked=false;$('model-import-review').hidden=true;$('model-import-apply').disabled=true}
 form.addEventListener('input',invalidate)
 for(const name of ['files','folder'])form.elements[name].addEventListener('change',()=>{form.elements[name==='files'?'folder':'files'].value='';invalidate()})
 async function sourceFiles(){
  const folder=form.elements.folder.files,selected=folder.length?folder:form.elements.files.files,directory=folder.length>0
  if(!selected.length)throw Error('Choose a project folder or standalone source files.')
  if(!directory&&(form.elements.format.value==='pbip'||form.elements.format.value==='dbt'&&Array.from(selected).some(f=>/\.sql$|^dbt_project\.ya?ml$/i.test(f.name))))throw Error('Choose the project root folder to retain source-relative paths for PBIP and dbt SQL.')
  const files=[]
  for(const file of selected){
   const relative=file.webkitRelativePath
   if(directory&&(!relative||!relative.includes('/')))throw Error('This browser did not retain folder paths. Choose a project folder in a supported browser.')
   const path=directory?relative.slice(relative.indexOf('/')+1):file.name
   if(file.size>262144)throw Error('Each source file is limited to 256 KiB.')
   const archive=/\.(twbx|tfl|tflx|pbix)$/i.test(file.name)
   if(archive&&file.size>196608)throw Error('Each TWBX archive is limited to 192 KiB before base64 encoding.')
   files.push({path,content:archive?btoa(Array.from(new Uint8Array(await file.arrayBuffer()),byte=>String.fromCharCode(byte)).join('')):await file.text()})
  }
  if(form.elements.format.value==='dbt'&&files.some(f=>/\.sql$/i.test(f.path))&&!files.some(f=>/^dbt_project\.ya?ml$/i.test(f.path)||/(?:^|\/)manifest\.json$/i.test(f.path)))throw Error('Choose the dbt project root containing dbt_project.yml or a manifest.json artifact, not an individual models or tests folder.')
  return files
 }
 const id=()=>{const value=form.elements.project.value;if(!/^[a-z][a-z0-9-]{0,63}$/.test(value))throw Error('Enter a valid project ID.');return value}
 async function load(){projectId=id();const r=await fetch('/api/operator/model-imports/'+projectId);if(r.status!==200&&r.status!==404)throw Error('Current project could not be read.');current=r.ok?await r.json():null;const box=$('model-import-current');box.replaceChildren();const p=document.createElement('p');p.textContent=current?'Imported revision '+current.revision+'. '+(current.report.compatible?(current.preparation?'Native draft mapping is available. Source step equivalence remains unproved; inspect each step before cutover.':'Translation is compatible; review exact source results in Models before publication.'):'Unresolved source semantics prevent publication.'):'No imported project yet.';box.append(p);if(current){const report=element('div');showReport(report,current);box.append(report);preparationImportActions(box,current,projectId,perform,status);if(current.report.compatible&&!current.preparation){const a=document.createElement('a');a.href='/app/models?project='+projectId;a.textContent='Review imported model';const actions=element('div');actions.className='actions';actions.append(a);box.append(actions);const download=element('button','Export rebuilt model');download.type='button';download.addEventListener('click',perform(async()=>{const r=await fetch('/api/operator/model-imports/'+projectId+'/export',{method:'POST',headers:{'content-type':'application'+'/'+'json'},body:JSON.stringify({reviewedRevision:current.revision})});if(!r.ok)throw Error((await r.json()).error);const url=URL.createObjectURL(await r.blob()),link=document.createElement('a');link.href=url;link.download=projectId+'.native.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Rebuilt model and source mapping exported.');}));actions.append(download)}}}
 form.addEventListener('submit',perform(async()=>{projectId=id();const files=await sourceFiles();const input={version:1,projectId,format:form.elements.format.value,files,bindings:JSON.parse(form.elements.bindings.value),formats:JSON.parse(form.elements.formats.value),...['powerquery','dataflow-gen1','dataflow-gen2','prep'].includes(form.elements.format.value)?{sourceOutputs:JSON.parse(form.elements.sourceOutputs.value||'[]')}:{},context:{modelVersion:'model-import',metricVersion:'source-measures',accountingBasis:form.elements.basis.value,calendar:JSON.parse(form.elements.calendar.value),rounding:'half-even'}};invalidate();await load();const uploadId=await upload(input,call,status,projectId),history=await call('history');plan=await call('plan',{uploadId,...(history.history.length?{catchup:true}:{})});showReport($('model-import-report'),plan.project,plan.fingerprint);$('model-import-review').hidden=false;status('Review the source compatibility, exact plan and unresolved items.')}))
 $('model-import-confirm').addEventListener('change',()=>{$('model-import-apply').disabled=!plan||!!plan.counts.rejected||!$('model-import-confirm').checked})
 $('model-import-apply').addEventListener('click',perform(async()=>{if(!plan||!$('model-import-confirm').checked)return;for(let i=0;i<20;i++){const result=await call('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(result.job.state==='completed'){await call('reconcile',{planId:plan.planId});invalidate();await load();status('Project imported and reconciled. Review exact model results before publication.');return}}status('Import checkpoint saved. Continue the same reviewed project import.')}))
 $('model-import-cancel').addEventListener('click',perform(async()=>{if(plan)await call('undo',{planId:plan.planId});invalidate();status('Project import cancelled. Retained original files remain owner-erasable.')}))
 $('model-load').addEventListener('click',perform(async()=>{invalidate();await load();if(current){form.elements.format.value=current.input.format;form.elements.bindings.value=JSON.stringify(current.input.bindings,null,2);form.elements.formats.value=JSON.stringify(current.input.formats,null,2);form.elements.sourceOutputs.value=current.input.sourceOutputs?JSON.stringify(current.input.sourceOutputs,null,2):'';form.elements.basis.value=current.input.context.accountingBasis;const calendar=JSON.stringify(current.input.context.calendar);if([...form.elements.calendar.options].some(option=>option.value===calendar))form.elements.calendar.value=calendar}status('Current project loaded.')}))
 $('model-erase').addEventListener('click',perform(async()=>{if(projectId!==id()||$('model-erase-id').value!==projectId)throw Error('Load the project and confirm its exact ID first.');const r=await fetch('/api/operator/model-imports/'+projectId+'/erase',{method:'POST',headers:{'content-type':'application'+'/'+'json'},body:JSON.stringify({confirmProject:projectId,reviewedRevision:current?.revision??null})});if(!r.ok)throw Error((await r.json()).error);invalidate();await load();status('Project, derived models, answers and retained originals withdrawn.')}))
 perform(async()=>{const r=await fetch('/api/operator/calendars');if(!r.ok)throw Error('Save a fiscal calendar in Company first.');const value=await r.json();for(const calendar of value.calendars){const option=document.createElement('option');option.value=JSON.stringify({id:calendar.id,version:calendar.version});option.textContent=calendar.name+' · '+calendar.version;form.elements.calendar.append(option)}})()
}
