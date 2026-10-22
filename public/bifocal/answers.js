import { element, table } from './file-view.js'
import { figure, label, stamp, when } from './format.js'
const $ = id => document.getElementById(id), zone = document.body.dataset.zone
let snapshot, pending=false
// Once an answer is on screen its title leads: routine messages stay in the live region, for screen readers only.
function status(message,error=false) { $('status').setAttribute('role',error?'alert':'status'); $('status').textContent=message; $('status').dataset.error=String(error); $('status').dataset.quiet=String(!error&&!!snapshot) }
async function request(path,data) {
 const response=await fetch('/api/operator/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
 const result=await response.json(); if(response.status===404)throw Error('Saved answer is unavailable. Recheck its id and retained source custody.');if(!response.ok)throw Error(result.reason ?? result.error);return result
}
async function action(work) { if(pending)return; pending=true; status('Working…'); document.querySelectorAll('button').forEach(button=>button.disabled=true);try{await work()}catch(error){status(error.message,true)}finally{pending=false;document.querySelectorAll('button').forEach(button=>button.disabled=false)} }
// A figure as a US reader expects it; any state other than a value reads as its own word.
const shown = (item,currency) => item.state === 'value' ? figure(item.value,item.unit,currency) : item.state.toUpperCase()
const KIND = {reports:'Saved report',dashboards:'Saved dashboard',queries:'Immutable snapshot'}
// Parts joined by "·" never leave a dot at a line's end: each dot travels with the part after it, and a stamp stays whole.
const dotted = (parts,whole=-1) => parts.flatMap((text,i)=>[...(i?[' ']:[]),element('span',(i?'·\u00a0':'')+text,i===whole?'nowrap':undefined)])
function render(result) {
 snapshot=result;$('answer').hidden=false;document.body.dataset.answer='shown';$('answer-title').textContent=result.title ?? 'Exact answer'
 const currency=result.context.currency, measures=Object.keys(result.answer.totals), columns=[...result.definition.groupBy,...measures]
 $('snapshot-note').replaceChildren(...dotted([KIND[document.body.dataset.kind],stamp(result.createdAt,zone),result.answer.sourceWatermarks.map(source=>source.dataset).join(' + '),result.answer.certification==='unavailable'?'not certified':'',result.reproduced?'reproduced exactly':''].filter(Boolean),1))
 $('totals').replaceChildren(...measures.map(id=>{const total=result.answer.totals[id],tile=element('div',undefined,'kpi');const caption=element('span',undefined,'kpi-id');caption.append(...dotted([id,total.unit==='money'?currency:''].filter(Boolean)));tile.append(element('span',label(id),'kpi-label'),element('strong',shown(total,currency),'kpi-value'),caption);return tile}))
 $('groups').replaceChildren(table('Grouped results',columns.map(label),result.answer.rows.map(row=>[...row.dimensions,...measures.map(id=>shown(row.values[id],currency))]),columns.map((_,i)=>i>=result.definition.groupBy.length)))
 // Yellow marks a real exception; the standing "not certified" limitation sits in the meta line.
 $('certification').textContent=result.answer.commonSnapshot==='unavailable'?'No common upstream snapshot is available. This answer cannot be officially certified.':''
 $('context').textContent=JSON.stringify({snapshot:{id:result.snapshotId,createdAt:result.createdAt,...(result.artifactCreatedAt?{savedAt:result.artifactCreatedAt}:{})},exact:{totals:result.answer.totals,rows:result.answer.rows},definition:result.definition,context:result.context,sources:result.answer.sourceWatermarks,joinDiagnostics:result.answer.joinDiagnostics,digest:result.digest},null,2)
 $('title').value=result.title??'';current();status('Answer loaded. Exact values and retained context are shown below.')
}
// The retained answer on screen is the current row of the list, for a saved dashboard or report too.
function current() { for(const link of $('saved-list').querySelectorAll('a'))link.getAttribute('href')==='/app/queries/'+snapshot?.queryId?link.setAttribute('aria-current','true'):link.removeAttribute('aria-current') }
async function history() {
 const result=await request('queries');$('saved-list').replaceChildren()
 for(const item of result.queries){const link=element('a'),time=element('time',when(item.created_at,zone));time.dateTime=item.created_at;link.href='/app/queries/'+item.id;link.append(time,element('span','sha '+String(item.digest).slice(0,8),'digest'));$('saved-list').append(link)}
 if(!result.queries.length)$('saved-list').append(element('p','No saved answers yet.','side-note'))
 $('empty-answers').hidden=result.queries.length>0||!!document.body.dataset.id
 current()
}
$('query-form').onsubmit=event=>{event.preventDefault();action(async()=>{let definition;try{definition=JSON.parse($('definition').value)}catch{throw Error('Enter a valid JSON query definition.')}render(await request('queries/run',definition));await history()})}
for(const kind of ['dashboard','report'])$(kind).onclick=()=>action(async()=>{
 if(!snapshot)throw Error('Run or open an answer first.');const title=$('title').value.trim();if(!title)throw Error('Enter a title for this saved result.')
 const artifact=await request(kind+'s',{queryId:snapshot.queryId,title}),link=element('a','Open saved '+kind);link.href='/app/'+kind+'s/'+artifact.id;const row=element('p');row.append(link);$('artifact-links').append(row);status(`Saved ${kind} with this exact immutable answer.`)
})
$('rerun').onclick=()=>action(async()=>{
 try{render(await request(`queries/${snapshot.queryId}/rerun`,{}))}catch(error){
  if(error.message!=='snapshot_reproduction_failed')throw error
  $('certification').textContent='This snapshot could not be reproduced exactly from its retained sources and conventions. Check its source custody before relying on it.';throw Error('Reproduction failed. The retained answer is unchanged.')
 }
 status('Snapshot reproduced exactly from retained source and convention versions.')
})
action(async()=>{await history();if(document.body.dataset.id)render(await request(document.body.dataset.kind+'/'+document.body.dataset.id));else status('Paste a definition for your real imported data and saved calendar.')})
