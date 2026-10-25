import {element,table} from './file-view.js'
import {figure,label,stamp} from './format.js'
import {retainedExport} from './retained-export.js'

const $=id=>document.getElementById(id),root=$('dashboard-authoring'),zone=document.body.dataset.zone
let resource=null,draftReview=null,releaseReview=null,jsonChanged=false,busy=false
const status=(text,error=false)=>{const node=$('authoring-status');node.textContent=text;node.setAttribute('role',error?'alert':'status')}
const link=(text,path)=>{const node=element('a',text);node.href=path;return node}
async function api(path,data){
 const response=await fetch('/api/operator'+(path.startsWith('/')?path:'/'+path),{method:data===undefined?'GET':'POST',redirect:'error',headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
 if([401,403].includes(response.status)){$('authoring-editor')?.replaceChildren();$('published-dashboard')?.replaceChildren();throw Error('Current owner access is unavailable. Displayed definitions and results were cleared.')}
 const result=await response.json();if(!response.ok)throw Error(result.error??'Dashboard request refused');return result
}
function buttons(){
 if(root.dataset.mode==='view'||!$('authoring-save-draft'))return
 $('authoring-save-draft').disabled=busy||!draftReview
 $('authoring-publish').disabled=busy||releaseReview?.action!=='publish'
 $('authoring-rollback').disabled=busy||releaseReview?.action!=='rollback'
 $('authoring-review-publication').disabled=busy||!resource
 $('authoring-review-rollback').disabled=busy||!$('authoring-rollback-revision').value
}
async function action(work){
 if(busy)return;busy=true;buttons()
 for(const control of root.querySelectorAll('input,textarea,select,button')){control.dataset.previousDisabled=String(control.disabled);control.disabled=true}
 try{await work()}catch(error){status(error.message+'. Your unsaved input remains available unless authority was withdrawn.',true)}
 finally{busy=false;for(const control of root.querySelectorAll('input,textarea,select,button')){control.disabled=control.dataset.previousDisabled==='true';delete control.dataset.previousDisabled}buttons()}
}
function invalidate(){draftReview=null;releaseReview=null;$('authoring-draft-review').hidden=true;$('authoring-publication-review').textContent='';buttons()}
function inputField(text,name,value,{min=0,max=10000,type='number'}={}){
 const wrapper=element('label',text),input=element('input');input.name=name;input.type=type;input.value=String(value);input.required=true;input.setAttribute('aria-label',text)
 if(type==='number'){input.min=String(min);input.max=String(max);input.step='1'}wrapper.append(input);return wrapper
}
function fillDocument(document){
 if(document.version!==2||!Array.isArray(document.cards)||document.cards.length<2||document.cards.length>4||!Array.isArray(document.layout?.desktop)||!Array.isArray(document.layout?.phone))throw Error('Load a version 2 document with two to four cards and both layouts')
 $('authoring-title').value=document.title;$('authoring-document').value=JSON.stringify(document,null,2);jsonChanged=false
 const sections=document.cards.map((card,index)=>{
  const section=element('section',undefined,'panel');section.dataset.cardKey=card.key
  section.append(element('h2','Tile '+(index+1)),inputField('Tile '+(index+1)+' key','key',card.key,{type:'text'}))
  const query=element('label','Tile '+(index+1)+' query definition (JSON)'),area=element('textarea');area.name='definition';area.rows=8;area.value=JSON.stringify(card.definition,null,2);area.required=true;area.setAttribute('aria-label','Tile '+(index+1)+' query definition (JSON)');query.append(area);section.append(query)
  for(const layout of ['desktop','phone']){
   const placement=document.layout[layout].find(item=>item.key===card.key);if(!placement)throw Error('Every tile needs both layout placements')
   const fields=element('fieldset'),legend=element('legend',layout==='desktop'?'Desktop placement · 12 columns':'Phone placement · 1 column'),grid=element('div',undefined,'placement-fields');fields.append(legend,grid)
   for(const name of layout==='desktop'?['x','y','w','h']:['y','h'])grid.append(inputField('Tile '+(index+1)+' '+layout+' '+name,layout+'-'+name,placement[name],{min:['w','h'].includes(name)?1:0,max:name==='w'?12:name==='x'?11:name==='h'?1000:9999}))
   section.append(fields)
  }
  return section
 })
 $('authoring-cards').replaceChildren(...sections)
 if(busy)for(const control of $('authoring-cards').querySelectorAll('input,textarea')){control.dataset.previousDisabled='false';control.disabled=true}
}
function readDocument(){
 if(jsonChanged)fillDocument(JSON.parse($('authoring-document').value))
 if(!$('authoring-title').reportValidity()||!$('authoring-form').reportValidity())throw Error('Complete the title, query definitions and integer placements')
 const cards=[],layout={desktop:[],phone:[]}
 for(const section of $('authoring-cards').children){
  const value=name=>section.querySelector('[name="'+name+'"]')?.value,key=value('key')
  cards.push({key,definition:JSON.parse(value('definition'))})
  layout.desktop.push({key,...Object.fromEntries(['x','y','w','h'].map(name=>[name,Number(value('desktop-'+name))]))})
  layout.phone.push({key,x:0,y:Number(value('phone-y')),w:1,h:Number(value('phone-h'))})
 }
 const document={version:2,title:$('authoring-title').value,cards,layout}
 $('authoring-document').value=JSON.stringify(document,null,2);return document
}
function showResource(next,{fill=true}={}){
 resource=next;root.dataset.id=next.id;history.replaceState(null,'','/app/dashboard-authoring/'+next.id)
 if(fill)fillDocument(next.definition)
 $('authoring-heading').textContent=next.definition.title+' · editor';$('authoring-publication').hidden=false
 $('authoring-version').textContent='Draft revision '+next.revision+' · published '+(next.publishedRevision??'none')+' · generation '+next.generation
 $('authoring-published-links').replaceChildren(...(next.published?[link('Open published dashboard','/app/dashboard-authoring/'+next.id+'/view'),link('Open published dashboard TV','/app/dashboards/'+next.published.boardId+'/tv')]:[]))
 const choices=next.revisions.filter(item=>item.wasPublished&&item.revision!==next.publishedRevision)
 $('authoring-rollback-revision').replaceChildren(...choices.map(item=>{const option=element('option','Published revision '+item.revision);option.value=String(item.revision);return option}))
 $('authoring-history').textContent=JSON.stringify({revisions:next.revisions.map(({revision,wasPublished})=>({revision,wasPublished})),history:next.history},null,2);buttons()
}
async function list(){
 const result=await api('dashboard-authoring'),box=$('authoring-dashboard-list')
 box.replaceChildren(link('Create a new dashboard','/app/dashboard-authoring'))
 for(const item of result.dashboards){const row=element('p');row.append(link(item.definition.title,'/app/dashboard-authoring/'+item.id),document.createTextNode(' · draft '+item.revision+' · published '+(item.publishedRevision??'none')));box.append(row)}
 if(!result.dashboards.length)box.append(element('p','No authored dashboards yet.'))
}
async function queryChoices(){
 const result=await api('queries'),box=$('authoring-query-choices')
 for(const item of result.queries){const wrapper=element('label',undefined,'checkbox'),input=element('input');input.type='checkbox';input.name='queryId';input.value=item.id;wrapper.append(input,document.createTextNode(item.label));box.append(wrapper)}
 if(!result.queries.length)box.append(element('p','Retain exact answers before selecting them, or enter a complete native document.'))
}
async function published(){
 resource=await api('dashboard-authoring/'+root.dataset.id)
 if(!resource.published){status('This dashboard has no published revision.');return}
 const saved=resource.published,board=await api('dashboards/'+saved.boardId),document=saved.document
 if(!Array.isArray(board.cards)||board.cards.length!==document.cards.length)throw Error('Published board membership is unavailable')
 $('authoring-heading').textContent=document.title;$('published-version').textContent='Published revision '+saved.revision+' · retained board '+saved.boardId
 $('published-links').replaceChildren(link('Edit dashboard','/app/dashboard-authoring/'+resource.id),link('Open dashboard TV','/app/dashboards/'+saved.boardId+'/tv'))
 const cards=document.cards.map((card,index)=>{
  const retained=board.cards[index],section=element('section',undefined,'panel published-tile');section.dataset.cardKey=card.key
  for(const layout of ['desktop','phone']){const placement=document.layout[layout].find(item=>item.key===card.key);for(const name of ['x','y','w','h'])section.style.setProperty('--'+layout+'-'+name,String(placement[name]))}
  section.append(element('h2',card.key),element('p',retained.definition.dataset+' · retained '+stamp(retained.createdAt,zone),'meta'))
  const measures=Object.keys(retained.answer.totals),shown=value=>value.state==='value'?figure(value.value,value.unit,retained.context.currency):value.state.toUpperCase(),totals=element('dl',undefined,'published-totals')
  for(const measure of measures){const item=element('div');item.append(element('dt',label(measure)),element('dd',shown(retained.answer.totals[measure])));totals.append(item)}
  section.append(totals)
  const box=element('div',undefined,'published-table');box.append(table('Exact '+card.key+' results',[...retained.definition.groupBy.map(label),...measures.map(label)],retained.answer.rows.map(row=>[...row.dimensions,...measures.map(measure=>shown(row.values[measure]))])));section.append(box,retainedExport(retained.snapshotId))
  const details=element('details'),summary=element('summary','Retained definition and source versions'),pre=element('pre',JSON.stringify({definition:retained.definition,watermarks:retained.answer.sourceWatermarks,digest:retained.digest},null,2));details.append(summary,pre);section.append(details);return section
 })
 $('published-dashboard').replaceChildren(...cards);status('Published layout and exact retained answers loaded. Draft edits do not change this view.')
}
if(root.dataset.mode==='view')action(published)
else{
 $('authoring-document').oninput=()=>{jsonChanged=true;invalidate()}
 $('authoring-title').oninput=invalidate;$('authoring-form').oninput=invalidate
 $('authoring-load-document').onclick=()=>action(async()=>{fillDocument(JSON.parse($('authoring-document').value));invalidate();status('Native document loaded. Review the exact draft before saving.')})
 $('authoring-use-answers').onclick=()=>action(async()=>{
  const ids=[...$('authoring-query-choices').querySelectorAll('input:checked')].map(input=>input.value)
  if(ids.length<2||ids.length>4)throw Error('Select two to four retained answers')
  if(!$('authoring-title').reportValidity())return
  const answers=await Promise.all(ids.map(id=>api('queries/'+id))),cards=answers.map((answer,index)=>({key:'card-'+(index+1),definition:answer.definition}))
  fillDocument({version:2,title:$('authoring-title').value,cards,layout:{desktop:cards.map((card,index)=>({key:card.key,x:index%2*6,y:Math.floor(index/2),w:6,h:1})),phone:cards.map((card,index)=>({key:card.key,x:0,y:index,w:1,h:1}))}});invalidate();status('Selected actual query definitions loaded. Desktop and phone placements are independent.')
 })
 $('authoring-form').onsubmit=event=>{event.preventDefault();action(async()=>{
  const document=readDocument(),input={document,...(resource?{id:resource.id,previousRevision:resource.revision}:{})},review=await api('/dashboard-authoring/review',input)
  draftReview={input:{...input,document:review.document},digest:review.digest};$('authoring-draft-diff').textContent=JSON.stringify(review,null,2);$('authoring-draft-review').hidden=false;status('Exact draft reviewed. Save reviewed draft creates a new immutable revision.')
 })}
 $('authoring-save-draft').onclick=()=>action(async()=>{
  if(!draftReview)throw Error('Review the current draft first')
  const next=await api('/dashboard-authoring/apply',{...draftReview.input,reviewedDigest:draftReview.digest});draftReview=null;releaseReview=null;showResource(next);$('authoring-draft-review').hidden=true;status('Draft revision '+next.revision+' saved. Published reading is unchanged.');await list()
 })
 const reviewRelease=actionName=>action(async()=>{
  if(!resource)throw Error('Save a reviewed draft first')
  const revision=actionName==='publish'?resource.revision:Number($('authoring-rollback-revision').value)
  const input={revision,previousGeneration:resource.generation,action:actionName},review=await api('dashboard-authoring/'+resource.id+'/publication/review',input)
  releaseReview={...input,digest:review.digest};$('authoring-publication-review').textContent=JSON.stringify(review,null,2);status('Exact '+actionName+' review ready for revision '+revision+'.')
 })
 const applyRelease=actionName=>action(async()=>{
  if(releaseReview?.action!==actionName)throw Error('Review this exact '+actionName+' first')
  const {revision,previousGeneration,digest}=releaseReview,next=await api('dashboard-authoring/'+resource.id+'/'+actionName,{revision,previousGeneration,reviewedDigest:digest});releaseReview=null;showResource(next,{fill:false});$('authoring-publication-review').textContent='';status('Published revision '+next.publishedRevision+'. The published reader uses its retained layout and answers.');await list()
 })
 $('authoring-review-publication').onclick=()=>reviewRelease('publish');$('authoring-publish').onclick=()=>applyRelease('publish')
 $('authoring-review-rollback').onclick=()=>reviewRelease('rollback');$('authoring-rollback').onclick=()=>applyRelease('rollback')
 $('authoring-rollback-revision').onchange=()=>{releaseReview=null;buttons()}
 $('authoring-reload').onclick=()=>action(async()=>{const next=await api('dashboard-authoring/'+resource.id);showResource(next,{fill:false});invalidate();status('Current version reloaded. Your unsaved input was retained. Review it again against this version before saving.')})
 action(async()=>{await Promise.all([list(),queryChoices()]);if(root.dataset.id)showResource(await api('dashboard-authoring/'+root.dataset.id));status('Edit desktop and phone placement, then review and save the exact draft.')})
}
