import {element,metadata,table} from './file-view.js'
import {newStep,renderGraph,graphSQL} from './preparation-graph.js'
import {showPreparationReview} from './preparation-review.js'

const $=id=>document.getElementById(id),form=$('preparation-form')
if(form){
 const section=$('preparation'),mode=$('prep-mode'),dataset=$('prep-dataset'),sql=$('prep-sql')
 let steps=[],headId=null,version=null,revisions=[],reviewed=null,busy=false,activeMode='visual',imported=null
 const status=(message,error=false)=>{$('prep-status').textContent=message;$('prep-status').dataset.error=String(error)}
 const validId=(value,label)=>{if(!/^[a-z][a-z0-9-]{0,63}$/.test(value))throw Error('Enter a valid '+label+' using lowercase letters, digits and hyphens.');return value}
 const id=()=>validId($('prep-id').value,'preparation ID')
 function controls(){
  $('prep-save').disabled=busy||!reviewed?.compatible||!$('prep-confirm').checked
  $('prep-add').disabled=busy||steps.length>=32
  $('prep-revision').disabled=busy||!revisions.length
  $('prep-revision-load').disabled=$('prep-restore-review').disabled=busy||!revisions.length
 }
 function invalidate(){reviewed=null;$('prep-confirm').checked=false;$('prep-review').hidden=true;controls()}
 function changed(){invalidate();if(activeMode==='visual')sql.value=graphSQL(steps)}
 function graph(){renderGraph($('prep-steps'),steps,changed);$('prep-graph-source').textContent=(dataset.value||'Source dataset')+' → '+steps.length+' ordered steps → draft output';controls()}
 function editingMode(value){activeMode=value;mode.value=value;$('prep-visual').hidden=value!=='visual';$('prep-sql-editor').hidden=value!=='sql'}
 const call=async(preparation,action,body)=>{
  const response=await fetch('/api/operator/preparations/'+preparation+(action?'/'+action:''),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const value=await response.json()
  if(!response.ok){const error=Error([value.error,value.reason].filter(Boolean).join(': '));error.status=response.status;throw error}
  return value
 }
 async function perform(work){
  if(busy)return
  busy=true;const disabled=new Map([...section.querySelectorAll('button,input,select,textarea')].map(node=>[node,node.disabled]));disabled.forEach((_,node)=>{node.disabled=true})
  try{await work()}catch(error){invalidate();if(error.status===409)headId=null;status('Preparation unavailable: '+error.message,true)}
  finally{busy=false;disabled.forEach((value,node)=>{node.disabled=value});controls()}
 }
 function history(){
  const select=$('prep-revision');select.replaceChildren()
  for(const revision of [...revisions].reverse()){const option=element('option','Revision '+revision.version+(revision.version===version?' · current draft':''));option.value=String(revision.version);select.append(option)}
  if(!revisions.length){const option=element('option','No saved revisions');option.value='';select.append(option)}
  $('prep-version').textContent=headId?(version===null?'New preparation. No saved revision.':'Current saved draft revision '+version+'.'):'No saved preparation loaded.'
  $('prep-history').replaceChildren(...(revisions.length?[table('Immutable draft history',['Version','Saved at','Digest','Source revisions'],[...revisions].reverse().map(revision=>[revision.version,revision.createdAt,revision.digest,revision.sources.map(source=>source.dataset+' · '+source.revision).join('\n')]))]:[]));controls()
 }
 async function loadHead(preparation){
  let current
  try{current=await call(preparation)}catch(error){if(error.status!==404)throw error;current={version:null,revisions:[]}}
  headId=preparation;version=current.version;revisions=current.revisions;history();return current
 }
 function useDocument(document){imported=document.imported??null;dataset.value=document.dataset;steps=structuredClone(document.steps);sql.value=graphSQL(steps);$('prep-source').replaceChildren();invalidate();graph()}
 function selectedRevision(){
  if(headId!==id())throw Error('Load the current preparation first.')
  const revision=revisions.find(item=>item.version===Number($('prep-revision').value))
  if(!revision)throw Error('Choose a saved preparation revision.')
  return revision
 }
 async function review(restoreRevision){
  const preparation=id();validId(dataset.value,'source dataset ID')
  invalidate();if(headId!==preparation)await loadHead(preparation)
  const payload=restoreRevision?{document:structuredClone(restoreRevision.document),previousVersion:version}:activeMode==='sql'?{dataset:dataset.value,sql:sql.value,previousVersion:version,...imported?{imported}:{}}:{document:{version:1,dataset:dataset.value,steps:structuredClone(steps),...imported?{imported}:{}},previousVersion:version}
  const value=await call(preparation,'review',payload)
  steps=structuredClone(value.document.steps);dataset.value=value.document.dataset;sql.value=value.sql;graph()
  reviewed={id:preparation,payload,digest:value.digest,version,compatible:value.compatible,restoreVersion:restoreRevision?.version}
  $('prep-save').textContent=restoreRevision?'Restore reviewed draft revision':'Save reviewed draft'
  showPreparationReview($('prep-review-report'),value,version,restoreRevision?.version);$('prep-review').hidden=false
  status(value.compatible?(restoreRevision?'Prior revision reviewed against current sources. Confirm the exact output before restoring.':'Draft reviewed. Inspect output, source revisions and lineage before saving.'):'Draft blocked at step '+value.error.step+': '+value.error.code+'. The saved draft is unchanged.')
 }
 $('prep-id').addEventListener('input',()=>{headId=null;version=null;revisions=[];invalidate();history()})
 dataset.addEventListener('input',()=>{$('prep-source').replaceChildren();changed();$('prep-graph-source').textContent=(dataset.value||'Source dataset')+' → '+steps.length+' ordered steps → draft output'})
 sql.addEventListener('input',invalidate)
 $('prep-confirm').addEventListener('change',controls)
 $('prep-revision').addEventListener('change',invalidate)
 $('prep-add').addEventListener('click',()=>{if(busy||steps.length>=32)return;steps.push(newStep($('prep-operation').value));changed();graph()})
 mode.addEventListener('change',()=>{
  const next=mode.value
  if(next===activeMode)return
  if(next==='sql'){sql.value=graphSQL(steps);invalidate();editingMode('sql');return}
  mode.value='sql'
  perform(async()=>{await review();editingMode('visual')})
 })
 form.addEventListener('submit',event=>{event.preventDefault();perform(()=>review())})
 $('prep-load').addEventListener('click',()=>perform(async()=>{
  invalidate();const current=await loadHead(id()),revision=current.revisions.find(item=>item.version===current.version)
  if(revision){useDocument(revision.document);editingMode('visual');status('Current saved draft loaded. Review again before saving any change.')}
  else status('No saved preparation with this ID. Build and review a new draft.')
 }))
 $('prep-source-load').addEventListener('click',()=>perform(async()=>{
  const source=validId(dataset.value,'source dataset ID'),response=await fetch('/api/operator/datasets/'+source),value=await response.json()
  if(!response.ok)throw Error(value.error??'Source unavailable.')
  $('prep-source').replaceChildren(metadata([['Source dataset',source],['Current revision',value.revision],['Source rows',value.table.rows.length]]),table('Actual source columns',['Column','Type'],value.table.columns.map(column=>[column.name,column.type])))
  status('Current source schema loaded. Review preparation to pin its exact revision.')
 }))
 $('prep-revision-load').addEventListener('click',()=>perform(async()=>{const revision=selectedRevision();useDocument(revision.document);editingMode('visual');status('Revision '+revision.version+' loaded for editing. Current saved draft remains revision '+version+'.')}))
 $('prep-restore-review').addEventListener('click',()=>perform(async()=>{const revision=selectedRevision();useDocument(revision.document);editingMode('visual');await review(revision)}))
 $('prep-save').addEventListener('click',()=>perform(async()=>{
  if(!reviewed?.compatible||!$('prep-confirm').checked)throw Error('Review and confirm a compatible draft first.')
  const exact=reviewed,action=exact.restoreVersion?'restore':'save',body=exact.restoreVersion?{restoreVersion:exact.restoreVersion,previousVersion:exact.version,reviewedDigest:exact.digest}:{...exact.payload,reviewedDigest:exact.digest}
  const saved=await call(exact.id,action,body)
  invalidate();await loadHead(exact.id);status((action==='restore'?'Prior draft restored':'Draft saved')+' as revision '+saved.version+'. Sources, published models and charts are unchanged.')
 }))
 document.addEventListener('bifocal-preparation-import',event=>perform(async()=>{const value=event.detail;$('prep-id').value=value.id;await loadHead(value.id);useDocument(value.document);editingMode('visual');status('Imported flow loaded with its exact project revision and column lineage. Edit and review before saving.')}))
 graph();history()
}
