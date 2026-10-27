import {renderBoard,boardChoices} from './board.js'
import { element, table } from './file-view.js'
import { figure, label, stamp, when } from './format.js'
import { retainedExport } from './retained-export.js'
const $ = id => document.getElementById(id), zone = document.body.dataset.zone
let snapshot, pending=false
// Once an answer is on screen its title leads: routine messages stay in the live region, for screen readers only.
function status(message,error=false) { $('status').setAttribute('role',error?'alert':'status'); $('status').textContent=message; $('status').dataset.error=String(error); $('status').dataset.quiet=String(!error&&!!snapshot) }
async function request(path,data) {
 const response=await fetch('/api/operator/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
 const result=await response.json(); if(response.status===404){document.querySelector('.eyebrow-links')?.setAttribute('hidden','');throw Error('This answer isn’t available. It may have been erased, or the link may be wrong.')}if(!response.ok)throw Error(result.reason ?? result.error);return result
}
async function action(work) { if(pending)return; pending=true; status('Working…'); document.querySelectorAll('button').forEach(button=>{button.dataset.previousDisabled=String(button.disabled);button.disabled=true});try{await work()}catch(error){status(error.message,true)}finally{pending=false;document.querySelectorAll('button').forEach(button=>button.disabled=button.dataset.previousDisabled==='true')} }
// A figure as a US reader expects it; any state other than a value reads as its own word.
const shown = (item,currency) => item.state === 'value' ? figure(item.value,item.unit,currency) : item.state.toUpperCase()
// Parts joined by "·" never leave a dot at a line's end: each dot travels with the part after it, and a stamp stays whole.
const dotted = (parts,whole=-1) => parts.flatMap((text,i)=>[...(i?[' ']:[]),element('span',(i?'·\u00a0':'')+text,i===whole?'nowrap':undefined)])
// An answer is named as its list row reads: the dataset, then its measures ("Demo orders · Revenue, Orders").
const answerName = (dataset,measures) => [label(dataset),...(measures.length?[measures.map(label).join(', ')]:[])].join(' ·\u00a0')
// The held notice carries its own way to the exact test, as h1's notice carries its action.
function notice(quality,common) {
 const parts=[]
 if(quality&&quality.state!=='healthy'){const link=element('a','Data quality');link.href='/app/quality';parts.push('Quality '+quality.state+'. Retained result; inspect ',link,' for the exact test. ')}
 if(common==='unavailable')parts.push('No common upstream snapshot is available. This answer cannot be officially certified.')
 $('certification').replaceChildren(...parts)
}
// The definition reads as plain facts first; the exact JSON stays one disclosure deeper.
function facts(result) {
 const d=result.definition,c=result.context,rows=[['Dataset',label(d.dataset)],['Measures',d.measures.map(m=>label(m.id)).join(', ')],['Grouped by',d.groupBy.map(label).join(', ')||'Total only'],['Filters',d.filters?.length?String(d.filters.length):'None'],['Calendar',c.calendar?c.calendar.id+' · version '+c.calendar.version:'None'],['Currency',c.currency],['Sources',result.answer.sourceWatermarks.map(s=>s.dataset+' · revision '+String(s.revision).slice(0,12)).join(', ')],['Snapshot',result.snapshotId],['Digest',result.digest]]
 $('definition-facts').replaceChildren(...rows.filter(([,v])=>v).map(([name,value])=>{const item=element('div');item.append(element('dt',name),element('dd',value));return item}))
}
function render(result) {
 if(renderBoard(result,request,action,status)){snapshot=result;return}
 snapshot=result;$('answer').hidden=false;document.body.dataset.answer='shown';const name=result.title?.replaceAll(' · ',' ·\u00a0') ?? answerName(result.definition.dataset,result.definition.measures.map(m=>m.id));$('answer-title').textContent=name;document.title=name+' · Bifocal'
 const currency=result.context.currency, measures=Object.keys(result.answer.totals), columns=[...result.definition.groupBy,...measures]
 $('snapshot-note').replaceChildren(...dotted(['Immutable snapshot',stamp(result.createdAt,zone),result.answer.sourceWatermarks.map(source=>source.dataset).join(' + '),result.answer.certification==='unavailable'?'not certified':'',result.reproduced?'reproduced exactly':''].filter(Boolean),1))
 // A cell is its figure over its name; money adds only its currency, never the measure id again.
 $('totals').replaceChildren(...measures.map(id=>{const total=result.answer.totals[id],tile=element('div',undefined,'kpi'),name=element('span',label(id),'kpi-label');if(total.unit==='money')name.append(' ',element('span',currency,'kpi-unit'));const text=shown(total,currency);tile.append(name,element('strong',text,text.length>10?'kpi-value long':'kpi-value'));return tile}))
 $('groups').replaceChildren(table('Grouped results',columns.map(label),result.answer.rows.map(row=>[...row.dimensions,...measures.map(id=>shown(row.values[id],currency))]),columns.map((_,i)=>i>=result.definition.groupBy.length)))
 let exports=document.getElementById('retained-answer-exports');if(!exports){exports=document.createElement('div');exports.id='retained-answer-exports';$('groups').after(exports)}exports.replaceChildren(retainedExport(result.queryId,{folded:true}))
 // Yellow marks a real exception; the standing "not certified" limitation sits in the meta line.
 notice(result.quality,result.answer.commonSnapshot);facts(result)
 $('context').textContent=JSON.stringify({snapshot:{id:result.snapshotId,createdAt:result.createdAt,...(result.artifactCreatedAt?{savedAt:result.artifactCreatedAt}:{})},exact:{totals:result.answer.totals,rows:result.answer.rows},definition:result.definition,context:result.context,sources:result.answer.sourceWatermarks,joinDiagnostics:result.answer.joinDiagnostics,digest:result.digest},null,2)
 $('title').value=result.title??'';current();status('Answer loaded. Exact values and retained context are shown below.')
}
// The retained answer on screen is the current row of the Answers list. Saved dashboards and reports are filed in
// Library, so they draw Library's side list and name their source answer with a plain link instead.
function current() {
 const list=$('saved-list'),source=$('source-answer')
 if(source&&snapshot?.queryId){source.href='/app/queries/'+snapshot.queryId;source.hidden=false}
 if(list)for(const link of list.querySelectorAll('a'))link.getAttribute('href')==='/app/queries/'+snapshot?.queryId?link.setAttribute('aria-current','true'):link.removeAttribute('aria-current')
}
async function history() {
 const result=await request('queries'),list=$('saved-list');boardChoices(result.queries)
 $('empty-answers').hidden=result.queries.length>0||!!document.body.dataset.id
 if(!list)return
 list.replaceChildren()
 // Each row reads as h1's list: the answer's name first, then one quiet line with its author and time. Answers are the
 // owner's own, so the author is the signed-in owner; the digest lives in the definition.
 const author=document.querySelector('.topbar .who')?.textContent
 for(const item of result.queries){const link=element('a'),meta=element('span',undefined,'row-meta'),time=element('time',when(item.created_at,zone)),[dataset,measures='']=String(item.label??'').split(' · ');time.dateTime=item.created_at;link.href='/app/queries/'+item.id;meta.append(...(author?[author,' · ']:[]),time);link.append(element('span',answerName(dataset,measures?measures.split(', '):[]),'row-name'),meta);list.append(link)}
 if(!result.queries.length)list.append(element('p','No saved answers yet.','side-note'))
 current()
}
// A new answer takes the screen: the writing folds away, the answer's title comes into view, and the address becomes
// the answer's own so a reload opens it again.
function arrived() {
 $('new-answer').open=false;window.history.replaceState(null,'','/app/queries/'+snapshot.queryId)
 const title=$('answer-title').getBoundingClientRect();if(title.top<0||title.bottom>innerHeight)$('answer').scrollIntoView({block:'start'})
}
$('query-form').onsubmit=event=>{event.preventDefault();action(async()=>{let definition;try{definition=JSON.parse($('definition').value)}catch{throw Error('Enter a valid JSON query definition.')}render(await request('queries/run',definition));await history();arrived()})}
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
action(async()=>{await history();if(document.body.dataset.id)render(await request(document.body.dataset.kind+'/'+document.body.dataset.id));else status('Open a retained answer, or paste a definition under New exact answer.')})

if($('compose-form').tagName==='FORM')$('compose-form').onsubmit=event=>{event.preventDefault();action(async()=>{const form=event.currentTarget,queryIds=[...form.querySelectorAll('input[name=queryIds]:checked')].map(input=>input.value);const result=await request('dashboards',{title:form.elements.title.value,queryIds}),link=element('a','Open cross-system dashboard');link.href='/app/dashboards/'+result.id;$('board-created').replaceChildren(link);status('Dashboard saved with the exact selected answers.')})}
