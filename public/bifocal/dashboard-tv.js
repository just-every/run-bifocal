import {element,table} from './file-view.js'
import {figure,label,stamp} from './format.js'
import {retainedExport} from './retained-export.js'

const $=id=>document.getElementById(id),root=$('dashboard-tv'),zone=document.body.dataset.zone
const tiles=new Map(),names={fresh:'Fresh',stale:'Stale',empty:'Empty',failed:'Failed',loading:'Loading'}
let activeFilters=[]
let running=false,busy=false,timer=null,requestController=null,viewGeneration=0
const message=(text,error=false)=>{const node=$('tv-status');node.textContent=text;node.setAttribute('role',error?'alert':'status')}
const shown=(value,currency)=>value?.state==='value'?figure(value.value,value.unit,currency):String(value?.state??'unavailable').toUpperCase()
function currentExports(tile,data){
 const box=element('div'),prepare=element('button','Prepare current exports'),note=element('p','Prepare summary and underlying CSV and XLSX downloads. This action retains one exact current answer.','hint'),status=element('p'),downloads=element('div')
 box.dataset.tileExports='';box.setAttribute('aria-label','Current tile exports');prepare.type='button'
 status.dataset.tileExportStatus='';status.setAttribute('aria-label','Current tile export status');status.setAttribute('role','status');status.setAttribute('aria-live','polite')
 const unavailable=tile.withdraw||!['fresh','stale','empty'].includes(tile.status)
 prepare.disabled=unavailable
 if(unavailable)status.textContent='Refresh this tile successfully before preparing current exports. Last-good values cannot prepare exports.'
 box.append(note,prepare,status,downloads)
 prepare.onclick=async()=>{
  const current=settings();if(!current)return
  prepare.disabled=true;status.textContent='Retaining the exact displayed answer for exports…'
  try{
   const response=await fetch('/api/operator/dashboards/'+encodeURIComponent(root.dataset.id)+'/tiles/'+encodeURIComponent(tile.id)+'/export-snapshot',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({definitionHash:data.answer.definitionHash,watermarks:data.answer.sourceWatermarks,maxAgeSeconds:current.maxAgeSeconds,filters:data.interactionFilters??[]})})
   if([401,403,404].includes(response.status)){
    clearValues();message('Dashboard export access unavailable. Previously displayed values were cleared.',true);return
   }
   const result=await response.json()
   if(result.withdraw===true){clearValues();message('Dashboard values were withdrawn and cleared.',true);return}
   if(!response.ok)throw Error(result.error??'Current export preparation unavailable')
   if(typeof result.queryId!=='string'||!result.queryId)throw Error('Retained export answer could not be read')
   if(!box.isConnected||tiles.get(tile.id)?.data!==data)return
   downloads.replaceChildren(retainedExport(result.queryId));status.textContent='Exact current answer retained. Choose a summary or underlying download below.'
  }catch(error){
   if(!box.isConnected)return
   status.textContent='Export preparation failed: '+String(error.message).replaceAll('_',' ')+'. Refresh the tile before preparing exports again.'
  }
 }
 return box
}
function settings(){
 if(!$('tv-controls').reportValidity())return null
 return {interval:Number($('tv-interval').value),maxAgeSeconds:Number($('tv-max-age').value)}
}
function renderTile(tile){
 const section=element('section',undefined,'panel tv-tile')
 section.dataset.tileId=tile.id;section.dataset.state=tile.status;section.setAttribute('aria-busy',String(tile.status==='loading'))
 section.setAttribute('aria-label',tile.title)
 section.append(element('h2',tile.title))
 const state=element('p',names[tile.status],'tv-state');state.dataset.tileStatus='';state.dataset.state=tile.status;section.append(state)
 if(tile.error)section.append(element('p','Refresh failed: '+tile.error,'note'))
 const last=element('p',tile.successAt?'Last successful refresh: '+stamp(tile.successAt,zone):'No successful refresh yet.','meta');last.dataset.lastSuccess=tile.successAt??'';section.append(last)
 if(tile.data&&['failed','loading'].includes(tile.status))section.append(element('p','Showing last-good values from '+stamp(tile.successAt,zone)+'. These values are not a successful current refresh.','note'))
 if(tile.withdraw)section.append(element('p','Previously displayed values were withdrawn and cleared.','note'))
 if(tile.data){
  const data=tile.data,measures=Object.keys(data.answer.totals),currency=data.context.currency
  if(data.status==='stale'||data.freshness==='stale')section.append(element('p','Source age exceeds the selected maximum. Values are stale.','note'))
  if(data.observedAt)section.append(element('p','Oldest source observation: '+stamp(data.observedAt,zone),'meta'))
  if(data.status==='empty')section.append(element('p','No rows match this tile.'))
  const totals=element('dl',undefined,'tv-totals')
  for(const measure of measures){const item=element('div');item.append(element('dt',label(measure)),element('dd',shown(data.answer.totals[measure],currency)));totals.append(item)}
  section.append(totals)
  const rows=data.answer.rows.map(row=>[...row.dimensions,...measures.map(measure=>shown(row.values[measure],currency))])
  const box=element('div',undefined,'tv-table');box.append(table('Exact '+tile.title+' results',[...data.definition.groupBy.map(label),...measures.map(label)],rows,[...data.definition.groupBy.map(()=>false),...measures.map(()=>true)]));section.append(box)
  const watermarks=element('ul',undefined,'tv-watermarks');watermarks.dataset.watermarks=''
  for(const source of data.watermarks??data.answer.sourceWatermarks??[])watermarks.append(element('li',`${source.dataset} · revision ${source.revision} · observed ${stamp(source.observedAt??source.updatedAt,zone)}`))
  section.append(watermarks,currentExports(tile,data))
  if(['fresh','stale'].includes(tile.status)){
   const controls=element('details'),summary=element('summary','Cross-filter from this tile');controls.append(summary)
   const dimensions=commonDimensions()
   for(const row of data.answer.rows)for(let index=0;index<data.definition.groupBy.length;index++){
    const column=data.definition.groupBy[index],value=row.dimensions[index]
    if(!dimensions.includes(column))continue
    const button=element('button','Filter '+label(column)+' to '+String(value??'empty'));button.type='button'
    button.onclick=()=>applyFilters([...activeFilters.filter(filter=>filter.column!==column),{column,op:'eq',value}]);controls.append(button)
   }
   section.append(controls)
  }
 }
 return section
}
function commonDimensions(){
 const definitions=[...tiles.values()].map(tile=>tile.data?.definition)
 if(!definitions.length||definitions.some(definition=>!definition))return []
 return definitions[0].groupBy.filter(column=>definitions.every(definition=>definition.groupBy.includes(column)))
}
function filterControls(){
 const select=$('tv-filter-column'),previous=select.value
 select.replaceChildren(...commonDimensions().map(column=>{const option=element('option',label(column));option.value=column;return option}))
 if([...select.options].some(option=>option.value===previous))select.value=previous
 $('tv-filter-apply').disabled=!select.options.length
 $('tv-filter-state').textContent=activeFilters.length?'Reader filters: '+activeFilters.map(filter=>label(filter.column)+' = '+String(filter.value??'empty')).join('; ')+'. Saved tile restrictions remain in force.':'No reader filters. Saved tile restrictions remain in force.'
}
function applyFilters(filters){
 if(busy)return
 activeFilters=filters
 // Never show last-good values or exports under a different reader context.
 tiles.clear();$('tv-cards').replaceChildren();filterControls();refresh()
}
function render(){ $('tv-cards').replaceChildren(...[...tiles.values()].map(renderTile));filterControls() }
function timerState(){
 $('tv-start').disabled=running;$('tv-pause').disabled=!running
 $('tv-timer').textContent=running?'Automatic refresh every '+$('tv-interval').value+' seconds while this page is open.':'Automatic refresh paused. Start runs only while this page is open.'
}
function pause(){running=false;clearTimeout(timer);timer=null;timerState()}
function schedule(){
 clearTimeout(timer);timer=null
 if(!running)return
 const current=settings()
 if(!current){pause();return}
 timer=setTimeout(()=>refresh(),current.interval*1000)
}
function clearValues(){
 viewGeneration++;requestController?.abort();pause();tiles.clear();$('tv-cards').replaceChildren();$('tv-title').textContent='Dashboard TV'
}
function failedTiles(error){
 for(const tile of tiles.values()){tile.status='failed';tile.error=error;tile.withdraw=false}
 render()
}
async function refresh(){
 if(busy)return
 const current=settings();if(!current){pause();return}
 const generation=viewGeneration,requestedFilters=structuredClone(activeFilters)
 clearTimeout(timer);timer=null;busy=true;$('tv-refresh').disabled=true
 for(const tile of tiles.values()){tile.status='loading';tile.error=null;tile.withdraw=false}
 render();message('Refreshing dashboard tiles…')
 requestController=new AbortController()
 const timeout=setTimeout(()=>requestController?.abort(),30000)
 try{
  const response=await fetch('/api/operator/dashboards/'+encodeURIComponent(root.dataset.id)+'/refresh',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxAgeSeconds:current.maxAgeSeconds,filters:activeFilters}),signal:requestController.signal})
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
    card.interactionFilters=requestedFilters;tile.data=card;tile.successAt=result.refreshedAt
   }
   next.set(card.id,tile)
  }
  tiles.clear();for(const [id,tile] of next)tiles.set(id,tile)
  $('tv-title').textContent=result.title;render()
  const counts=result.cards.reduce((all,card)=>(all[card.status]=(all[card.status]??0)+1,all),{})
  message('Dashboard refreshed: '+Object.entries(counts).map(([state,count])=>count+' '+state).join(', ')+'.',!!counts.failed)
 }catch(error){failedTiles(error.name==='AbortError'?'Refresh timed out':error.message);message('Dashboard refresh failed. Any retained last-good values are dated and marked failed.',true)}
 finally{clearTimeout(timeout);requestController=null;busy=false;$('tv-refresh').disabled=false;timerState();schedule()}
}
$('tv-filter-apply').onclick=()=>{const column=$('tv-filter-column').value;if(column)applyFilters([...activeFilters.filter(filter=>filter.column!==column),{column,op:'eq',value:$('tv-filter-value').value}])}
$('tv-filter-clear').onclick=()=>applyFilters([])
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
