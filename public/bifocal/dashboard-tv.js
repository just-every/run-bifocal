import {element,table} from './file-view.js'
import {figure,label,stamp} from './format.js'
import {retainedExport} from './retained-export.js'

const $=id=>document.getElementById(id),root=$('dashboard-tv'),zone=document.body.dataset.zone
const tiles=new Map(),names={fresh:'Fresh',stale:'Stale',empty:'Empty',failed:'Failed',loading:'Loading'}
let activeFilters=[],activeFields=null,bookmarks=[]
let running=false,busy=false,foreground=false,queued=null,waiters=[],timer=null,requestController=null,viewGeneration=0,authorityGeneration=0
const message=(text,error=false)=>{const node=$('tv-status'),role=error?'alert':'status';if(node.textContent===text&&node.getAttribute('role')===role)return;node.textContent=text;node.setAttribute('role',role)}
// Actions taken while a refresh is out wait for it instead of being refused, so background refreshes never lock controls.
const idle=()=>busy?new Promise(resolve=>waiters.push(resolve)):Promise.resolve()
const shown=(value,currency)=>value?.state==='value'?figure(value.value,value.unit,currency):String(value?.state??'unavailable').toUpperCase()
// Each tile is drawn once and then updated in place, keyed by its id: a refresh changes only what changed, so an open
// cross-filter disclosure, prepared downloads and the page's scroll survive it. A refresh in progress changes nothing
// visible; a failed one says so beside its dated last-good values.
const views=new Map()
// A failed tile says what happened in plain words; its code stays on the tile as data only.
const FAILURES={dashboard_conventions_changed:'Company conventions changed after this dashboard was saved, so its tiles can’t refresh as saved.',dashboard_filter_dimension_unavailable:'This tile can’t be filtered by the chosen field.',dashboard_field_selection_unavailable:'This tile can’t show the chosen field.',dataset_not_found:'This tile’s source data was erased or isn’t available.'}
const failure=error=>FAILURES[error]??(/^[a-z][a-z0-9_]*$/.test(error)?'This tile’s source or definition changed, so it couldn’t refresh.':error)
const answerKey=data=>data?JSON.stringify([data.answer.definitionHash,data.answer.sourceWatermarks,data.interactionFilters??[],data.interactionFields??null]):''
const setText=(node,text)=>{if(node.textContent!==text)node.textContent=text}
function exportBlocked(tile){return !tile||tile.withdraw||!['fresh','stale','empty'].includes(tile.status)}
function exportBox(id){
 const box=element('div'),prepare=element('button','Prepare current exports'),note=element('p','Prepare summary and underlying CSV and XLSX downloads. This action retains one exact current answer.','hint'),status=element('p'),downloads=element('div')
 box.dataset.tileExports='';box.setAttribute('aria-label','Current tile exports');prepare.type='button'
 status.dataset.tileExportStatus='';status.setAttribute('aria-label','Current tile export status');status.setAttribute('role','status');status.setAttribute('aria-live','polite')
 box.append(note,prepare,status,downloads)
 const reset=tile=>{box.dataset.key=answerKey(tile?.data);box.dataset.failed='';downloads.replaceChildren();prepare.disabled=exportBlocked(tile);setText(status,prepare.disabled?'Refresh this tile successfully before preparing current exports. Last-good values cannot prepare exports.':'')}
 prepare.onclick=async()=>{
  const tile=tiles.get(id),data=tile?.data,key=answerKey(data)
  if(!data||exportBlocked(tile))return
  const current=settings();if(!current)return
  prepare.disabled=true;status.textContent='Retaining the exact displayed answer for exports…'
  try{
   const response=await fetch('/api/operator/dashboards/'+encodeURIComponent(root.dataset.id)+'/tiles/'+encodeURIComponent(id)+'/export-snapshot',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({definitionHash:data.answer.definitionHash,watermarks:data.answer.sourceWatermarks,maxAgeSeconds:current.maxAgeSeconds,filters:data.interactionFilters??[],fields:data.interactionFields??null})})
   if([401,403,404].includes(response.status)){
    clearValues();message('Dashboard export access unavailable. Previously displayed values were cleared.',true);return
   }
   const result=await response.json()
   if(result.withdraw===true){clearValues();message('Dashboard values were withdrawn and cleared.',true);return}
   if(!response.ok)throw Error(result.error??'Current export preparation unavailable')
   if(typeof result.queryId!=='string'||!result.queryId)throw Error('Retained export answer could not be read')
   if(!box.isConnected||answerKey(tiles.get(id)?.data)!==key)return
   downloads.replaceChildren(retainedExport(result.queryId));status.textContent='Exact current answer retained. Choose a summary or underlying download below.'
  }catch(error){
   if(!box.isConnected)return
   box.dataset.failed='true';status.textContent='Export preparation failed: '+String(error.message).replaceAll('_',' ')+'. Refresh the tile before preparing exports again.'
  }
 }
 return {box,update:tile=>{if(box.dataset.key!==answerKey(tile.data)||box.dataset.failed||prepare.disabled!==exportBlocked(tile)&&!downloads.childElementCount&&status.textContent!=='Retaining the exact displayed answer for exports…')reset(tile)}}
}
function settings(){
 const form=$('tv-controls')
 if(!form.checkValidity()){$('tv-display').open=true;form.reportValidity();return null}
 return {interval:Number($('tv-interval').value),maxAgeSeconds:Number($('tv-max-age').value)}
}
/** The source list beside a tile: names, short revisions and observation times; a separator never ends a line. */
const watermarkText=source=>`${source.dataset} ·\u00a0revision ${String(source.revision).slice(0,12)} ·\u00a0observed ${stamp(source.observedAt??source.updatedAt,zone)}`
function tileView(id){
 if(views.has(id))return views.get(id)
 const section=element('section',undefined,'panel tv-tile'),title=element('h2'),state=element('p',undefined,'tv-state'),notes=element('div',undefined,'tv-notes'),last=element('p',undefined,'meta')
 const data=element('div',undefined,'tv-data'),observed=element('p',undefined,'meta'),totals=element('dl',undefined,'tv-totals'),tableBox=element('div',undefined,'tv-table'),more=element('p','Scroll sideways for more columns →','hint tv-more'),watermarks=element('ul',undefined,'tv-watermarks')
 const cross=element('details',undefined,'tv-cross'),exports=exportBox(id)
 section.dataset.tileId=id;state.dataset.tileStatus='';watermarks.dataset.watermarks='';cross.append(element('summary','Cross-filter from this tile'));more.hidden=true
 data.append(observed,totals,tableBox,more,watermarks,exports.box,cross);section.append(title,state,notes,last,data)
 // A table wider than its tile says so: a fade at the cut edge and one line under it, until scrolled to the end.
 const cue=()=>{const wrap=tableBox.querySelector('.tablewrap'),hidden=!!wrap&&wrap.scrollLeft+wrap.clientWidth<wrap.scrollWidth-1;tableBox.classList.toggle('more',hidden);more.hidden=!hidden}
 tableBox.addEventListener('scroll',cue,true);new ResizeObserver(cue).observe(tableBox)
 const view={section,title,state,notes,last,data,observed,totals,tableBox,watermarks,cross,exports,cue}
 views.set(id,view);return view
}
function updateTile(tile){
 const view=tileView(tile.id),{section}=view
 section.dataset.state=tile.status;section.setAttribute('aria-busy',String(tile.status==='loading'));section.setAttribute('aria-label',tile.title)
 setText(view.title,tile.title)
 if(tile.status==='loading')return view
 setText(view.state,names[tile.status]);view.state.dataset.state=tile.status
 const data=tile.data,notes=[]
 section.dataset.error=tile.error??''
 if(tile.error)notes.push(['note','Refresh failed. '+failure(tile.error)])
 if(data&&tile.status==='failed')notes.push(['note','Showing last-good values from '+stamp(tile.successAt,zone)+'. These values are not a successful current refresh.'])
 if(tile.withdraw)notes.push(['note','Previously displayed values were withdrawn and cleared.'])
 if(data&&(data.status==='stale'||data.freshness==='stale'))notes.push(['note','Source age exceeds the selected maximum. Values are stale.'])
 if(data?.status==='empty')notes.push(['','No rows match this tile.'])
 if(view.notes.dataset.text!==JSON.stringify(notes)){view.notes.dataset.text=JSON.stringify(notes);view.notes.replaceChildren(...notes.map(([kind,text])=>element('p',text,kind||undefined)))}
 setText(view.last,tile.successAt?'Last successful refresh: '+stamp(tile.successAt,zone):'No successful refresh yet.');view.last.dataset.lastSuccess=tile.successAt??''
 view.data.hidden=!data
 if(!data)return view
 const measures=Object.keys(data.answer.totals),currency=data.context.currency
 view.observed.hidden=!data.observedAt;setText(view.observed,data.observedAt?'Oldest source observation: '+stamp(data.observedAt,zone):'')
 const totals=measures.map(measure=>[label(measure),shown(data.answer.totals[measure],currency)])
 if(view.totals.dataset.text!==JSON.stringify(totals)){view.totals.dataset.text=JSON.stringify(totals);view.totals.replaceChildren(...totals.map(([name,value])=>{const item=element('div');item.append(element('dt',name),element('dd',value));return item}))}
 const headers=[...data.definition.groupBy.map(label),...measures.map(label)],rows=data.answer.rows.map(row=>[...row.dimensions,...measures.map(measure=>shown(row.values[measure],currency))])
 if(view.tableBox.dataset.text!==JSON.stringify([tile.title,headers,rows])){view.tableBox.dataset.text=JSON.stringify([tile.title,headers,rows]);view.tableBox.replaceChildren(table('Exact '+tile.title+' results',headers,rows,[...data.definition.groupBy.map(()=>false),...measures.map(()=>true)]));requestAnimationFrame(view.cue)}
 const sources=(data.watermarks??data.answer.sourceWatermarks??[]).map(watermarkText)
 if(view.watermarks.dataset.text!==JSON.stringify(sources)){view.watermarks.dataset.text=JSON.stringify(sources);view.watermarks.replaceChildren(...sources.map(text=>element('li',text)))}
 view.exports.update(tile)
 view.cross.hidden=!['fresh','stale'].includes(tile.status)
 if(!view.cross.hidden){
  const dimensions=commonDimensions(),choices=[],seen=new Set()
  for(const row of data.answer.rows)for(let index=0;index<data.definition.groupBy.length;index++){
   const column=data.definition.groupBy[index],value=row.dimensions[index],choice=JSON.stringify([column,value])
   if(dimensions.includes(column)&&!seen.has(choice)){seen.add(choice);choices.push([column,value])}
  }
  if(view.cross.dataset.choices!==JSON.stringify(choices)){
   view.cross.dataset.choices=JSON.stringify(choices)
   view.cross.replaceChildren(view.cross.firstElementChild,...choices.map(([column,value])=>{const button=element('button','Filter '+label(column)+' to '+String(value??'empty'));button.type='button';button.onclick=()=>applyFilters([...activeFilters.filter(filter=>filter.column!==column),{column,op:'eq',value}]);return button}))
  }
 }
 return view
}
function commonDimensions(){
 const definitions=[...tiles.values()].map(tile=>tile.data?{groupBy:tile.data.availableDimensions??tile.data.definition.groupBy}:null)
 if(!definitions.length||definitions.some(definition=>!definition))return []
 return definitions[0].groupBy.filter(column=>definitions.every(definition=>definition.groupBy.includes(column)))
}
function filterControls(){
 const select=$('tv-filter-column'),previous=select.value,field=$('tv-field')
 // Options are rebuilt only when the shared dimensions change, so an open list survives a refresh.
 const dimensions=commonDimensions(),key=JSON.stringify(dimensions)
 if(field.dataset.dimensions!==key){field.dataset.dimensions=key;field.replaceChildren(element('option','All authored fields'),...dimensions.map(column=>{const option=element('option',label(column));option.value=column;return option}));field.options[0].value=''}
 if(field.value!==(activeFields?.[0]??''))field.value=activeFields?.[0]??''
 // Only a refresh the person asked for holds the controls until it lands.
 const locked=busy&&foreground
 field.disabled=locked
 if(select.dataset.dimensions!==key){select.dataset.dimensions=key;select.replaceChildren(...dimensions.map(column=>{const option=element('option',label(column));option.value=column;return option}))
  if([...select.options].some(option=>option.value===previous))select.value=previous}
 $('tv-filter-apply').disabled=locked||!select.options.length;$('tv-filter-clear').disabled=locked;$('tv-bookmark-save').disabled=locked;$('tv-bookmark-open').disabled=locked||!bookmarks.length
 $('tv-filter-state').textContent=activeFilters.length?'Reader filters: '+activeFilters.map(filter=>label(filter.column)+' = '+String(filter.value??'empty')).join('; ')+'. Saved tile restrictions remain in force.':'No reader filters. Saved tile restrictions remain in force.'
}
function applyFilters(filters,fields=activeFields){
 if(busy){queued=[filters,fields];return}
 activeFilters=filters;activeFields=fields;viewGeneration++
 // Never show last-good values or exports under a different reader context.
 tiles.clear();views.clear();$('tv-cards').replaceChildren();filterControls();refresh()
}
function render(){
 const cards=$('tv-cards')
 for(const [id,view] of views)if(!tiles.has(id)){view.section.remove();views.delete(id)}
 let previous=null
 for(const tile of tiles.values()){const {section}=updateTile(tile),next=previous?previous.nextSibling:cards.firstChild;if(section!==next)cards.insertBefore(section,next);previous=section}
 filterControls()
}
function timerState(){
 $('tv-start').disabled=running;$('tv-pause').disabled=!running
 $('tv-timer').textContent=running?'Refreshing every '+$('tv-interval').value+' seconds while this page is open':'Automatic refresh paused'
}
function pause(){running=false;clearTimeout(timer);timer=null;timerState()}
function schedule(){
 clearTimeout(timer);timer=null
 if(!running)return
 const current=settings()
 if(!current){pause();return}
 timer=setTimeout(()=>refresh(true),current.interval*1000)
}
function clearValues(){
 viewGeneration++;authorityGeneration++;requestController?.abort();pause();tiles.clear();activeFilters=[];activeFields=null;bookmarks=[];$('tv-filter-value').value='';$('tv-bookmark-name').value='';$('tv-bookmarks').replaceChildren();$('tv-filter-column').replaceChildren();$('tv-field').replaceChildren();delete $('tv-filter-column').dataset.dimensions;delete $('tv-field').dataset.dimensions;views.clear();$('tv-filter-state').textContent='Reader filters cleared.';$('tv-bookmark-status').textContent='Bookmark access unavailable.';$('tv-cards').replaceChildren();$('tv-title').textContent='Dashboard TV'
}
function failedTiles(error){
 for(const tile of tiles.values()){tile.status='failed';tile.error=error;tile.withdraw=false}
 render()
}
async function refresh(background=false){
 if(busy)return
 const current=settings();if(!current){pause();return}
 const generation=viewGeneration,requestedFilters=structuredClone(activeFilters),requestedFields=structuredClone(activeFields)
 clearTimeout(timer);timer=null;busy=true;foreground=!background;$('tv-refresh').disabled=foreground
 for(const tile of tiles.values()){tile.status='loading';tile.error=null;tile.withdraw=false}
 render();if(foreground)message('Refreshing dashboard tiles…')
 requestController=new AbortController()
 const timeout=setTimeout(()=>requestController?.abort(),30000)
 try{
  const response=await fetch('/api/operator/dashboards/'+encodeURIComponent(root.dataset.id)+'/refresh',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxAgeSeconds:current.maxAgeSeconds,filters:activeFilters,fields:activeFields}),signal:requestController.signal})
  if([401,403,404].includes(response.status)){
   clearValues();message('Dashboard access unavailable. Previously displayed values were cleared.',true);return
  }
  const result=await response.json()
  if(generation!==viewGeneration)return
  if(result.withdraw===true){clearValues();message('Dashboard values were withdrawn and cleared. Refresh requires current owner access and valid source custody.',true);return}
  if(!response.ok)throw Error(result.error??'Dashboard refresh unavailable')
  if(result.id!==root.dataset.id||!Array.isArray(result.cards))throw Error('Dashboard refresh response could not be read')
  const next=new Map()
  for(const card of result.cards){
   if(!['fresh','stale','empty','failed'].includes(card.status))throw Error('Unknown dashboard tile state')
   const previous=tiles.get(card.id),tile={id:card.id,title:card.title,status:card.status,error:card.error,withdraw:card.withdraw===true,data:previous?.data,successAt:previous?.successAt}
   if(tile.withdraw){tile.data=null;tile.successAt=null}
   else if(card.status!=='failed'){
    if(!card.answer||!card.context||!card.definition)throw Error('Dashboard tile answer could not be read')
    card.interactionFilters=requestedFilters;card.interactionFields=requestedFields;tile.data=card;tile.successAt=result.refreshedAt
   }
   next.set(card.id,tile)
  }
  tiles.clear();for(const [id,tile] of next)tiles.set(id,tile)
  setText($('tv-title'),result.title);render()
  const counts=result.cards.reduce((all,card)=>(all[card.status]=(all[card.status]??0)+1,all),{})
  message('Dashboard refreshed: '+Object.entries(counts).map(([state,count])=>count+' '+state).join(', ')+'.',!!counts.failed)
 }catch(error){failedTiles(error.name==='AbortError'?'Refresh timed out':error.message);message('Dashboard refresh failed. Any retained last-good values are dated and marked failed.',true)}
 finally{
  clearTimeout(timeout);requestController=null;busy=false;foreground=false;$('tv-refresh').disabled=false
  const next=queued,ready=waiters;queued=null;waiters=[];ready.forEach(resolve=>resolve())
  if(next){applyFilters(...next);return}
  filterControls();timerState();schedule()
 }
}
async function bookmarkRequest(path='',data){
 const response=await fetch('/api/operator/dashboards/'+encodeURIComponent(root.dataset.id)+'/bookmarks'+path,{method:data?'POST':'GET',redirect:'error',headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})})
 if([401,403,404].includes(response.status)){clearValues();bookmarks=[];$('tv-bookmarks').replaceChildren();throw Error('Bookmark access unavailable')}
 const result=await response.json();if(!response.ok)throw Error(result.error??'Bookmark unavailable');return result
}
async function loadBookmarks(){
 const generation=authorityGeneration,result=await bookmarkRequest();if(generation!==authorityGeneration)return;const selected=$('tv-bookmarks').value;bookmarks=result.bookmarks
 $('tv-bookmarks').replaceChildren(...bookmarks.map(bookmark=>{const option=element('option',bookmark.name+' · revision '+bookmark.revision);option.value=bookmark.name;return option}))
 if(bookmarks.some(bookmark=>bookmark.name===selected))$('tv-bookmarks').value=selected
 $('tv-bookmark-open').disabled=busy&&foreground||!bookmarks.length
}
$('tv-bookmarks').onchange=()=>{const bookmark=bookmarks.find(bookmark=>bookmark.name===$('tv-bookmarks').value);if(bookmark){$('tv-bookmark-name').value=bookmark.name;$('tv-bookmark-revision').value=bookmark.revision}}
$('tv-bookmark-save').onclick=async()=>{
 if($('tv-bookmark-save').disabled)return
 $('tv-bookmark-save').disabled=true
 try{await idle();const name=$('tv-bookmark-name').value.trim(),previous=bookmarks.find(bookmark=>bookmark.name===name);const saved=await bookmarkRequest('',{name,previousRevision:previous?.revision??null,filters:activeFilters,fields:activeFields});await loadBookmarks();$('tv-bookmarks').value=saved.name;$('tv-bookmark-revision').value=saved.revision;$('tv-bookmark-status').textContent='Personal bookmark saved as revision '+saved.revision+'. Saved dashboard unchanged.'}
 catch(error){$('tv-bookmark-status').textContent='Bookmark save failed: '+error.message+'. Reload the page to inspect concurrent changes.'}
 finally{$('tv-bookmark-save').disabled=false}
}
$('tv-bookmark-open').onclick=async()=>{
 await idle()
 if(!$('tv-bookmarks').value||!$('tv-bookmark-revision').reportValidity())return
 const generation=viewGeneration
 try{const saved=await bookmarkRequest('/'+encodeURIComponent($('tv-bookmarks').value)+'/'+Number($('tv-bookmark-revision').value));if(generation!==viewGeneration)return;applyFilters(saved.filters,saved.fields);$('tv-bookmark-status').textContent='Opened '+saved.name+' revision '+saved.revision+'. Saved dashboard unchanged.'}
 catch(error){$('tv-bookmark-status').textContent='Bookmark open failed: '+error.message}
}
loadBookmarks().catch(error=>{$('tv-bookmark-status').textContent=error.message})
$('tv-field').onchange=()=>applyFilters(activeFilters,$('tv-field').value?[$('tv-field').value]:null)
$('tv-filter-apply').onclick=()=>{const column=$('tv-filter-column').value;if(column)applyFilters([...activeFilters.filter(filter=>filter.column!==column),{column,op:'eq',value:$('tv-filter-value').value}])}
$('tv-filter-clear').onclick=()=>applyFilters([],null)
$('tv-start').onclick=()=>{if(!settings())return;running=true;timerState();refresh()}
$('tv-pause').onclick=()=>{pause();message('Automatic refresh paused. Refresh now remains available.')}
$('tv-controls').onsubmit=event=>{event.preventDefault();refresh()}
$('tv-interval').onchange=()=>{if(running){timerState();if(!busy)schedule()}}
$('tv-max-age').onchange=()=>{message('Maximum source age will apply on the next refresh.')}
$('tv-fullscreen').onclick=async()=>{
 try{
  if(document.fullscreenElement===root)await document.exitFullscreen()
  else if(root.requestFullscreen)await root.requestFullscreen()
  else message('Fullscreen is unavailable in this browser.',true)
 }catch{message('Fullscreen could not be opened. The TV page remains available.',true)}
}
document.addEventListener('fullscreenchange',()=>{$('tv-fullscreen').textContent=document.fullscreenElement===root?'Exit fullscreen':'Enter fullscreen'})
window.addEventListener('pagehide',()=>{pause();requestController?.abort();clearValues()})
refresh()
