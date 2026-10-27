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
async function call(action,data){const r=await fetch('/api/operator/rdl-imports/'+reportId+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error((await r.json()).error);return r}
const input=()=>({reviewedRevision:project.revision,bindings:JSON.parse($('rdl-bindings').value),parameters:JSON.parse($('rdl-parameters').value),format:$('rdl-format').value})
const perform=work=>async event=>{event?.preventDefault();if(busy)return;busy=true;try{await work()}catch(error){invalidate();$('rdl-preview-status').textContent='Report preview unavailable: '+error.message}finally{busy=false}}
if($('rdl-preview-form')){
 $('rdl-preview-form').addEventListener('input',invalidate)
 $('rdl-preview-form').addEventListener('submit',perform(async()=>{
  invalidate();$('rdl-preview-status').textContent='Rendering the reviewed native query results…'
  const request=input(),result=await (await call('preview',request)).json();review={...request,exportedAt:result.exportedAt,reviewedDigest:result.digest}
  const box=$('rdl-preview-pages');box.append(metadata([['Layout','Readable'],['Pages',result.pages.length],['Source reconciliation','Pending'],['Delivery','Inactive']]))
  result.pages.forEach((page,index)=>{const details=element('details');details.open=index===0;details.append(element('summary','Readable page '+(index+1)),table('Readable report page '+(index+1),['Text'],page.shapes.flatMap(shape=>shape.kind==='text'?shape.lines.map(line=>[line]):[])));box.append(details)})
  $('rdl-download').disabled=false;$('rdl-preview-status').textContent='Readable report reviewed. Inspect the complete values before downloading. Source switch acceptance remains unavailable.'
 }))
 $('rdl-download').addEventListener('click',perform(async()=>{
  if(!review)throw Error('Review the current report first.')
  const response=await call('download',review),blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='report-'+reportId+'.'+review.format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  $('rdl-preview-status').textContent='Reviewed readable report downloaded. No subscription was activated.'
 }))
}
