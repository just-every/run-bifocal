import { element, table } from './file-view.js'
const $ = id => document.getElementById(id)
let snapshot, pending=false
function status(message,error=false) { $('status').setAttribute('role',error?'alert':'status'); $('status').textContent=message; $('status').dataset.error=String(error) }
async function request(path,data) {
 const response=await fetch('/api/operator/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
 const result=await response.json(); if(response.status===404)throw Error('Saved answer is unavailable. Recheck its id and retained source custody.');if(!response.ok)throw Error(result.reason ?? result.error);return result
}
async function action(work) { if(pending)return; pending=true; status('Working…'); document.querySelectorAll('button').forEach(button=>button.disabled=true);try{await work()}catch(error){status(error.message,true)}finally{pending=false;document.querySelectorAll('button').forEach(button=>button.disabled=false)} }
const value = item => item.state === 'value' ? item.value : item.state.toUpperCase()
function render(result) {
 snapshot=result;$('answer').hidden=false;$('answer-title').textContent=result.title ?? 'Exact answer';$('snapshot-note').textContent=`Immutable snapshot ${result.snapshotId} · ${result.createdAt}`
 const measures=Object.keys(result.answer.totals)
 $('totals').replaceChildren(table('Totals after filtering',['Measure','Value','Unit','Value state'],measures.map(id=>[id,value(result.answer.totals[id]),result.answer.totals[id].unit==='money'?result.context.currency:result.answer.totals[id].unit,result.answer.totals[id].state])))
 $('groups').replaceChildren(table('Grouped results',[...result.definition.groupBy,...measures],result.answer.rows.map(row=>[...row.dimensions,...measures.map(id=>value(row.values[id]))])))
 $('certification').textContent=result.answer.commonSnapshot==='unavailable'?'No common upstream snapshot is available. This answer cannot be officially certified.':'Certification is unavailable. This retained answer is reproducible evidence.'
 $('context').textContent=JSON.stringify({definition:result.definition,context:result.context,sources:result.answer.sourceWatermarks,joinDiagnostics:result.answer.joinDiagnostics,digest:result.digest},null,2)
 $('title').value=result.title??'';status('Answer loaded. Exact values and retained context are shown below.')
}
async function history() {
 const result=await request('queries');$('saved-list').replaceChildren()
 for(const item of result.queries){const row=element('p'),link=element('a',item.created_at);link.href='/app/queries/'+item.id;row.append(link);$('saved-list').append(row)}
 if(!result.queries.length)$('saved-list').append(element('p','No saved answers yet.'))
}
$('query-form').onsubmit=event=>{event.preventDefault();action(async()=>{let definition;try{definition=JSON.parse($('definition').value)}catch{throw Error('Enter a valid JSON query definition.')}render(await request('queries/run',definition));await history()})}
for(const kind of ['dashboard','report'])$(kind).onclick=()=>action(async()=>{
 if(!snapshot)throw Error('Run or open an answer first.');const title=$('title').value.trim();if(!title)throw Error('Enter a title for this saved result.')
 const artifact=await request(kind+'s',{queryId:snapshot.queryId,title}),link=element('a','Open saved '+kind);link.href='/app/'+kind+'s/'+artifact.id;const row=element('p');row.append(link);$('artifact-links').append(row);status(`Saved ${kind} with this exact immutable answer.`)
})
$('rerun').onclick=()=>action(async()=>{render(await request(`queries/${snapshot.queryId}/rerun`,{}));status('Snapshot reproduced exactly from retained source and convention versions.')})
action(async()=>{await history();if(document.body.dataset.id)render(await request(document.body.dataset.kind+'/'+document.body.dataset.id));else status('Paste a definition for your real imported data and saved calendar.')})
