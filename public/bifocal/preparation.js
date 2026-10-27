import {element,metadata,table} from './file-view.js'
import {when} from './format.js'
import {newStep,renderGraph,graphSQL} from './preparation-graph.js'
import {showPreparationReview} from './preparation-review.js'
import {idSentence,requestProblem,stepProblem} from './preparation-errors.js'

const $=id=>document.getElementById(id),form=$('preparation-form'),zone=document.body.dataset.zone
// A refusal keeps its code as data and names the field it concerns; the page only ever shows its plain sentence.
class Refused extends Error{constructor(code,status,field=null,sentence=''){super(code);this.code=code;this.status=status;this.field=field;this.sentence=sentence}}
if(form){
 const section=$('preparation'),mode=$('prep-mode'),dataset=$('prep-dataset'),sql=$('prep-sql')
 let steps=[],headId=null,version=null,revisions=[],reviewed=null,busy=false,activeMode='visual',imported=null
 const status=(message,error=false)=>{$('prep-status').textContent=message;$('prep-status').dataset.error=String(error);$('prep-status').setAttribute('role',error?'alert':'status')}
 const validId=(value,field)=>{if(!/^[a-z][a-z0-9-]{0,63}$/.test(value))throw new Refused('invalid_id',400,field,idSentence);return value}
 const id=()=>validId($('prep-id').value,'prep-id')
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
  const value=await response.json().catch(()=>({}))
  if(!response.ok)throw new Refused(value.error??'preparation_conflict',response.status)
  return value
 }
 // The sentence goes beside its field, which is marked and described (focused once the card is usable again);
 // a refusal no field explains is said once at the top of the card. Typed values are never reset.
 function clear(){
  status('')
  for(const field of section.querySelectorAll('[aria-invalid]')){field.removeAttribute('aria-invalid');$(field.id+'-error')?.remove();const rest=(field.getAttribute('aria-describedby')??'').split(' ').filter(ref=>ref&&ref!==field.id+'-error').join(' ');rest?field.setAttribute('aria-describedby',rest):field.removeAttribute('aria-describedby')}
 }
 function mark(fieldId,sentence){
  const field=fieldId&&$(fieldId),box=field?.closest('.control')
  if(!box||field.closest('[hidden]'))return null
  const note=element('p',sentence,'field-error');note.id=field.id+'-error';box.append(note)
  field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',[field.getAttribute('aria-describedby'),note.id].filter(Boolean).join(' '))
  return field
 }
 function refuse(error){
  const [fieldId,sentence]=error.sentence?[error.field,error.sentence]:requestProblem(error instanceof Refused?error.code:'',{dataset:dataset.value,sql:activeMode==='sql'})
  const field=mark(fieldId,sentence);if(!field)status(sentence,true);return field
 }
 // A blocked review keeps the draft as it was: the step's own field (or the SQL, when that is what was reviewed)
 // carries the sentence, and the status says where the draft stopped.
 function blocked(value){
  if(value.compatible)return null
  const n=value.error.step,[key,sentence]=stepProblem(value.error.code,steps[n-1])
  const field=activeMode==='sql'?mark('prep-sql','Step '+n+': '+sentence):mark(key&&'prep-step-'+n+'-'+key,sentence)
  status(field?'Draft blocked at step '+n+'. The saved draft is unchanged.':'Draft blocked at step '+n+': '+sentence+' The saved draft is unchanged.',!field)
  return field
 }
 async function perform(work){
  if(busy)return
  busy=true;clear();const disabled=new Map([...section.querySelectorAll('button,input,select,textarea')].map(node=>[node,node.disabled]));disabled.forEach((_,node)=>{node.disabled=true})
  let invalid=null
  try{invalid=await work()??null}catch(error){invalidate();if(error.status===409)headId=null;invalid=refuse(error)}
  finally{busy=false;disabled.forEach((value,node)=>{node.disabled=value});controls();invalid?.focus()}
 }
 function history(){
  const select=$('prep-revision');select.replaceChildren()
  for(const revision of [...revisions].reverse()){const option=element('option','Revision '+revision.version+(revision.version===version?' · current draft':''));option.value=String(revision.version);select.append(option)}
  if(!revisions.length){const option=element('option','No saved revisions');option.value='';select.append(option)}
  $('prep-version').textContent=headId?(version===null?'New preparation. No saved revision.':'Current saved draft revision '+version+'.'):'No saved preparation loaded.'
  $('prep-history').replaceChildren(...(revisions.length?[table('Immutable draft history',['Version','Saved at','Digest','Source revisions'],[...revisions].reverse().map(revision=>[revision.version,when(revision.createdAt,zone),revision.digest,revision.sources.map(source=>source.dataset+' · '+source.revision).join('\n')]))]:[]));controls()
 }
 async function loadHead(preparation){
  let current
  try{current=await call(preparation)}catch(error){if(error.status!==404)throw error;current={version:null,revisions:[]}}
  headId=preparation;version=current.version;revisions=current.revisions;history();return current
 }
 function useDocument(document){imported=document.imported??null;dataset.value=document.dataset;steps=structuredClone(document.steps);sql.value=graphSQL(steps);$('prep-source').replaceChildren();invalidate();graph()}
 function selectedRevision(){
  if(headId!==id())throw new Refused('preparation_not_loaded',400,'prep-id','Load this preparation first, then choose one of its revisions.')
  const revision=revisions.find(item=>item.version===Number($('prep-revision').value))
  if(!revision)throw new Refused('preparation_revision_required',400,'prep-revision','Choose a saved revision.')
  return revision
 }
 async function review(restoreRevision){
  const preparation=id();validId(dataset.value,'prep-dataset')
  invalidate();if(headId!==preparation)await loadHead(preparation)
  const payload=restoreRevision?{document:structuredClone(restoreRevision.document),previousVersion:version}:activeMode==='sql'?{dataset:dataset.value,sql:sql.value,previousVersion:version,...imported?{imported}:{}}:{document:{version:1,dataset:dataset.value,steps:structuredClone(steps),...imported?{imported}:{}},previousVersion:version}
  const value=await call(preparation,'review',payload)
  steps=structuredClone(value.document.steps);dataset.value=value.document.dataset;sql.value=value.sql;graph()
  reviewed={id:preparation,payload,digest:value.digest,version,compatible:value.compatible,restoreVersion:restoreRevision?.version}
  $('prep-save').textContent=restoreRevision?'Restore reviewed draft revision':'Save reviewed draft'
  showPreparationReview($('prep-review-report'),value,version,restoreRevision?.version);$('prep-review').hidden=false
  if(value.compatible)status(restoreRevision?'Prior revision reviewed against current sources. Confirm the exact output before restoring.':'Draft reviewed. Inspect output, source revisions and lineage before saving.')
  return value
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
  perform(async()=>{const value=await review();editingMode('visual');return blocked(value)})
 })
 form.addEventListener('submit',event=>{event.preventDefault();perform(async()=>blocked(await review()))})
 $('prep-load').addEventListener('click',()=>perform(async()=>{
  invalidate();const current=await loadHead(id()),revision=current.revisions.find(item=>item.version===current.version)
  if(revision){useDocument(revision.document);editingMode('visual');status('Current saved draft loaded. Review again before saving any change.')}
  else status('No saved preparation with this ID. Build and review a new draft.')
 }))
 $('prep-source-load').addEventListener('click',()=>perform(async()=>{
  const source=validId(dataset.value,'prep-dataset'),response=await fetch('/api/operator/datasets/'+source),value=await response.json().catch(()=>({}))
  if(!response.ok)throw new Refused(value.error??'dataset_not_found',response.status)
  $('prep-source').replaceChildren(metadata([['Source dataset',source],['Current revision',value.revision],['Source rows',value.table.rows.length]]),table('Actual source columns',['Column','Type'],value.table.columns.map(column=>[column.name,column.type])))
  status('Current source schema loaded. Review preparation to pin its exact revision.')
 }))
 $('prep-revision-load').addEventListener('click',()=>perform(async()=>{const revision=selectedRevision();useDocument(revision.document);editingMode('visual');status('Revision '+revision.version+' loaded for editing. Current saved draft remains revision '+version+'.')}))
 $('prep-restore-review').addEventListener('click',()=>perform(async()=>{const revision=selectedRevision();useDocument(revision.document);editingMode('visual');return blocked(await review(revision))}))
 $('prep-save').addEventListener('click',()=>perform(async()=>{
  if(!reviewed?.compatible||!$('prep-confirm').checked)throw new Refused('preparation_review_required',400,null,'Review a compatible draft and confirm it first.')
  const exact=reviewed,action=exact.restoreVersion?'restore':'save',body=exact.restoreVersion?{restoreVersion:exact.restoreVersion,previousVersion:exact.version,reviewedDigest:exact.digest}:{...exact.payload,reviewedDigest:exact.digest}
  const saved=await call(exact.id,action,body)
  invalidate();await loadHead(exact.id);status((action==='restore'?'Prior draft restored':'Draft saved')+' as revision '+saved.version+'. Sources, published models and charts are unchanged.')
 }))
 document.addEventListener('bifocal-preparation-import',event=>perform(async()=>{const value=event.detail;$('prep-id').value=value.id;await loadHead(value.id);useDocument(value.document);editingMode('visual');status('Imported flow loaded with its exact project revision and column lineage. Edit and review before saving.')}))
 graph();history()
}
