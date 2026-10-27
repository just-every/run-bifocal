/** Current-owner native authoring. API content is rendered only through text nodes. */
export const editorScript=String.raw`
const byId=id=>document.getElementById(id);
const form=byId('chart-editor-form');
if(form){
 const query=byId('chart-query'),options=byId('chart-options'),title=byId('chart-title'),kind=byId('chart-kind');
 const dimension=byId('chart-dimension'),measure=byId('chart-measure'),orderField=byId('chart-order-field');
 const direction=byId('chart-order-direction'),nulls=byId('chart-order-nulls'),scale=byId('chart-scale'),selection=byId('chart-selection');
 const reviewButton=byId('chart-review'),createButton=byId('chart-create'),reloadButton=byId('chart-reload');
 const reviewSection=byId('chart-editor-review'),status=byId('chart-editor-status'),sourceLink=byId('chart-source-link');
 let source=null,reviewed=null,revision=0,loadRevision=0,busy=false;
 const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text);return element;};
 const option=(value,label)=>new Option(label,value);
 const unitLabel=m=>m.id+' · '+m.unit+' · '+m.scale+' decimal places';
 function message(text,error=false){status.textContent=text;status.dataset.error=String(error);status.setAttribute('role',error?'alert':'status');}
 function buttons(){reviewButton.disabled=busy||!source;createButton.disabled=busy||!reviewed;reloadButton.disabled=busy;}
 function invalidate(){revision++;reviewed=null;reviewSection.hidden=true;byId('chart-review-rows').replaceChildren();byId('chart-review-document').textContent='';buttons();}
 function failure(error){return error instanceof Error?error.message:'The request could not be completed. Review again before creating.';}
 async function api(path,body){
  const response=await fetch('/api/operator/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  if(!response.ok){
   const code=typeof data.error==='string'?data.error:'request_refused';
   if(response.status===401||response.status===403)throw new Error('The current installation owner must be signed in. Open Answers after signing in, then return to the chart builder. ('+code+')');
   if(response.status===404)throw new Error('This saved answer is no longer available. Choose another saved answer. ('+code+')');
   if(response.status===409)throw new Error('The source, conventions or reviewed definition changed. Review the current chart again before creating. ('+code+')');
   throw new Error('The chart request was refused: '+code+'. Check the selected answer and chart settings, then review again.');
  }
  return data;
 }
 function syncScale(){
  const required=kind.value==='vertical-bar'||kind.value==='area';
  scale.querySelector('option[value="auto"]').disabled=required;
  if(required)scale.value='zero';
  byId('chart-scale-hint').textContent=required?'Vertical bars and areas always include zero.':'Include zero or use the current values to set the range.';
 }
 function syncOrder(){
  const previous=orderField.value;
  orderField.replaceChildren(option(dimension.value,dimension.value+' · dimension'),option(measure.value,unitLabel(source.definition.measures.find(m=>m.id===measure.value))));
  if(previous===dimension.value||previous===measure.value)orderField.value=previous;
 }
 function resetSource(){
  source=null;options.disabled=true;sourceLink.hidden=true;byId('chart-source-note').textContent='';
  for(const control of [dimension,measure,orderField,selection])control.replaceChildren();
  invalidate();
 }
 async function loadSource(id){
  const requestVersion=++loadRevision;resetSource();
  if(!id){message('Choose a saved answer to bind the chart fields.');return;}
  message('Loading the saved answer definition…');
  try{
   const value=await api('queries/'+encodeURIComponent(id));
   if(requestVersion!==loadRevision)return;
   const definition=value.definition;
   if(!definition||!Array.isArray(definition.groupBy)||definition.groupBy.length!==1||!Array.isArray(definition.measures)||!definition.measures.length){
    message('This chart builder needs exactly one grouping dimension and at least one measure. Choose another saved answer or create a grouped answer in Answers.',true);return;
   }
   if(definition.measures.some(m=>m.id===definition.groupBy[0])){message('This answer uses the same name for a dimension and a measure. Choose an answer with distinct field names.',true);return;}
   source=value;
   dimension.replaceChildren(option(definition.groupBy[0],definition.groupBy[0]+' · dimension'));
   measure.replaceChildren(...definition.measures.map(m=>option(m.id,unitLabel(m))));
   selection.replaceChildren(option(definition.groupBy[0],definition.groupBy[0]+' · Chart selection'));
   syncOrder();syncScale();
   title.value=(definition.measures[0].id+' by '+definition.groupBy[0]).slice(0,160);
   sourceLink.href='/app/queries/'+encodeURIComponent(id);sourceLink.hidden=false;
   byId('chart-source-note').textContent='Dataset: '+definition.dataset+' · saved answer: '+id;
   options.disabled=false;buttons();message('Choose chart settings, then review the current exact values.');
  }catch(error){if(requestVersion===loadRevision)message(failure(error),true);}
 }
 async function loadAnswers(){
  const selected=query.value||form.dataset.query||'',requestVersion=++loadRevision;
  resetSource();query.disabled=true;reloadButton.disabled=true;byId('chart-empty').hidden=true;
  message('Loading saved answers…');
  try{
   const data=await api('queries');if(requestVersion!==loadRevision)return;
   if(!Array.isArray(data.queries))throw new Error('Saved answers could not be read. Reload the list to try again.');
   query.replaceChildren(option('','Choose a saved answer'),...data.queries.map(saved=>option(saved.id,saved.label+' · '+saved.created_at)));
   if(selected&&!data.queries.some(saved=>saved.id===selected))query.append(option(selected,'Requested saved answer · '+selected));
   query.disabled=!data.queries.length&&!selected;byId('chart-empty').hidden=!!data.queries.length||!!selected;
   if(selected){query.value=selected;await loadSource(selected);}
   else message(data.queries.length?'Choose a saved answer to bind the chart fields.':'No saved answers are available. Create an exact answer in Answers to get started.');
  }catch(error){if(requestVersion===loadRevision)message(failure(error),true);}
  finally{buttons();}
 }
 function chartDocument(){
  if(!source)throw new Error('Choose a saved answer with one grouping dimension first.');
  return {version:1,title:title.value.trim(),definition:structuredClone(source.definition),visual:{kind:kind.value,dimension:dimension.value,measure:measure.value,order:{field:orderField.value,direction:direction.value,nulls:nulls.value},missing:'gap',scale:{zero:scale.value==='zero',reverse:false},selection:{field:selection.value,label:'Chart selection'}}};
 }
 function exactValue(value,currency){
  if(!value)throw new Error('The reviewed answer is missing a bound measure. Choose another answer or review again.');
  if(value.state!=='value'||value.value===null)return value.state+(value.reason?' · '+value.reason:'')+' · '+value.unit;
  return (value.unit==='money'?currency+' ':'')+value.value+' '+value.unit+(value.exact?' · exact '+value.exact.numerator+'/'+value.exact.denominator:'')+(value.nulls?' · '+value.nulls+' null inputs':'')+(value.excluded?' · '+value.excluded+' excluded inputs':'');
 }
 function renderReview(data){
  const document=data.document,rows=data.view.rows,totals=data.view.totals,measures=document.definition.measures;
  const table=node('table'),caption=node('caption','Current exact rows and complete query totals');table.append(caption);
  const head=node('thead'),headRow=node('tr'),dimensionHeader=node('th',document.visual.dimension+' · dimension');dimensionHeader.scope='col';headRow.append(dimensionHeader);
  for(const m of measures){const th=node('th',unitLabel(m));th.scope='col';headRow.append(th);}head.append(headRow);table.append(head);
  const body=node('tbody');
  for(const row of rows){const tr=node('tr'),label=node('th',row.label===null?'Null':String(row.label));label.scope='row';tr.append(label);for(const m of measures)tr.append(node('td',exactValue(row.values[m.id],data.currency)));body.append(tr);}
  if(!rows.length){const tr=node('tr'),td=node('td','No matching rows in the current answer.');td.colSpan=measures.length+1;tr.append(td);body.append(tr);}table.append(body);
  const foot=node('tfoot'),totalRow=node('tr'),totalHeader=node('th','Complete query totals');totalHeader.scope='row';totalRow.append(totalHeader);for(const m of measures)totalRow.append(node('td',exactValue(totals[m.id],data.currency)));foot.append(totalRow);table.append(foot);
  const wrap=node('div');wrap.className='tablewrap';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Reviewed exact values; scroll horizontally for all measures');wrap.append(table);
  byId('chart-review-rows').replaceChildren(wrap);
  byId('chart-review-summary').textContent=document.title+' · '+rows.length+' groups · '+data.answer.filteredRows+' of '+data.answer.inputRows+' source rows after filtering. Review reflects current sources, which may differ from the saved answer.';
  byId('chart-review-document').textContent=JSON.stringify({document,answer:data.answer,digest:data.digest},null,2);
  reviewSection.hidden=false;
 }
 form.addEventListener('input',()=>{invalidate();message('Settings changed. Review the current chart again before creating.');});
 form.addEventListener('change',event=>{
  invalidate();
  if(event.target===query){loadSource(query.value);return;}
  if(source&&(event.target===measure||event.target===dimension))syncOrder();
  if(event.target===kind)syncScale();
  message('Settings changed. Review the current chart again before creating.');
 });
 reloadButton.addEventListener('click',()=>{if(!busy)loadAnswers();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  invalidate();const requestVersion=revision;
  busy=true;buttons();message('Reviewing the definition against current sources…');
  try{
   const document=chartDocument(),data=await api('chart-definitions/review',{document});
   if(requestVersion!==revision){message('Settings changed during review. Review the current chart again.');return;}
   if(typeof data.digest!=='string'||!data.document||!data.view||!Array.isArray(data.view.rows)||!data.view.totals||!data.answer)throw new Error('The chart review was incomplete. Review again before creating.');
   renderReview(data);reviewed={document:data.document,digest:data.digest,signature:JSON.stringify(document)};
   message('Current exact values reviewed. Create the chart, or edit and review again.');byId('chart-review-heading').focus();
  }catch(error){if(requestVersion===revision){invalidate();message(failure(error),true);}}
  finally{busy=false;buttons();}
 });
 createButton.addEventListener('click',async()=>{
  if(busy||!reviewed)return;
  if(JSON.stringify(chartDocument())!==reviewed.signature){invalidate();message('Settings changed. Review the current chart again before creating.',true);return;}
  const review=reviewed;busy=true;buttons();options.disabled=true;query.disabled=true;message('Creating the reviewed immutable chart…');
  try{
   const result=await api('chart-definitions/create',{document:review.document,reviewedDigest:review.digest});
   if(typeof result.id!=='string'||!/^[a-f0-9-]{36}$/.test(result.id))throw new Error('The chart response did not include a valid chart link. Open Answers to inspect saved results.');
   window.location.assign('/app/charts/'+encodeURIComponent(result.id));
  }catch(error){invalidate();message(failure(error),true);}
  finally{busy=false;options.disabled=!source;query.disabled=false;buttons();}
 });
 loadAnswers();
}
`;
