import {element,metadata,table} from './file-view.js'
const $=id=>document.getElementById(id)
let project=null,reportId=null,review=null,busy=false
const child=(node,name)=>node?.children.find(c=>c.name===name),children=(node,name)=>node?.children.filter(c=>c.name===name)??[]
const invalidate=()=>{review=null;$('rdl-download').disabled=true;$('rdl-preview-pages').replaceChildren()}
export function setRdlPreview(current,id){
 project=current;reportId=id;invalidate();$('rdl-preview').hidden=!current
 if(!current)return
 const bindings=current.definition.reports.flatMap(report=>children(child(report.tree,'DataSets'),'DataSet').map(dataset=>({file:report.file,dataset:dataset.attributes.Name,queryId:'',digest:'',fields:Object.fromEntries(children(child(dataset,'Fields'),'Field').map(f=>[f.attributes.Name,f.attributes.Name])),parameterFields:Object.fromEntries(children(child(child(dataset,'Query'),'QueryParameters'),'QueryParameter').map(p=>[p.attributes.Name,'']))})))
 $('rdl-bindings').value=JSON.stringify(bindings,null,2);$('rdl-parameters').value='{}';$('rdl-preview-status').textContent='Choose saved query IDs and digests, map fields and query parameters, then review.'
}
const errors={rdl_parameter_value_not_allowed:'Choose a parameter value permitted by its current lookup query.',rdl_complete_dataset_bindings_required:'Bind every dataset, including the supplied subreports.',rdl_query_binding_required:'Choose an exact saved native query and its digest for each dataset.',rdl_reviewed_query_changed:'Reload the saved query and review its current digest.',current_rdl_revision_required:'Reload the report draft and review its current revision.',exact_rdl_preview_required:'Review the current report and mappings before downloading.',rdl_division_by_zero:'A report expression divides by zero, including an evaluated IIF branch.',rdl_unresolved_translation_blocks_render:'Resolve the unsupported source items in the translation inventory first.'}
async function call(action,data){const r=await fetch('/api/operator/rdl-imports/'+reportId+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok){const failure=await r.json();throw Error(errors[failure.error]??'Review the report mappings and resolve unsupported source items before rendering.')}return r}
const input=()=>({reviewedRevision:project.revision,bindings:JSON.parse($('rdl-bindings').value),parameters:JSON.parse($('rdl-parameters').value),format:$('rdl-format').value})
const perform=work=>async event=>{event?.preventDefault();if(busy)return;busy=true;try{await work()}catch(error){invalidate();$('rdl-preview-status').textContent='Report preview unavailable: '+error.message}finally{busy=false}}
if($('rdl-preview-form')){
 $('rdl-preview-form').addEventListener('input',invalidate)
 $('rdl-preview-form').addEventListener('submit',perform(async()=>{
  invalidate();$('rdl-preview-status').textContent='Rendering the reviewed native query results…'
  const request=input(),result=await (await call('preview',request)).json();review={...request,exportedAt:result.exportedAt,reviewedDigest:result.digest}
  const box=$('rdl-preview-pages');box.append(metadata([['Layout','Readable'],['Pages',result.pages.length],['Source reconciliation','Pending'],['Delivery','Inactive']]))
  result.pages.forEach((page,index)=>{const details=element('details'),rows=[];details.open=index===0;for(const shape of page.shapes.filter(s=>s.kind==='text').sort((a,b)=>a.y-b.y||a.x-b.x)){const last=rows.at(-1);if(last?.y===shape.y)last.cells.push(shape.lines.join('\n'));else rows.push({y:shape.y,cells:[shape.lines.join('\n')]})}const columns=Math.max(...rows.map(row=>row.cells.length));details.append(element('summary','Readable page '+(index+1)),table('Readable report page '+(index+1),Array.from({length:columns},(_,i)=>i?'Value':'Report content'),rows.map(row=>Array.from({length:columns},(_,i)=>row.cells[i]??''))));box.append(details)})
  $('rdl-download').disabled=false;$('rdl-preview-status').textContent='Readable report reviewed. Inspect the complete values before downloading. Source switch acceptance remains unavailable.'
 }))
 $('rdl-download').addEventListener('click',perform(async()=>{
  if(!review)throw Error('Review the current report first.')
  const response=await call('download',review),blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='report-'+reportId+'.'+review.format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  $('rdl-preview-status').textContent='Reviewed readable report downloaded. No subscription was activated.'
 }))
}
