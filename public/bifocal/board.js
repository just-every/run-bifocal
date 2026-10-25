import {element,table,sourceView} from './file-view.js'
import {figure,label,stamp} from './format.js'
import {retainedExport} from './retained-export.js'
const $=id=>document.getElementById(id),zone=document.body.dataset.zone
let board,preview
/** A chart always retains its exact accessible table. Different measures and
 * sources get separate scales, never a combined conversion/revenue number. */
function chart(card,metric) {
 const rows=card.answer.rows.slice(0,20),valid=rows.filter(row=>row.values[metric]?.state==='value')
 const outer=element('div',undefined,'business-chart')
 outer.append(element('p',label(metric)+' · '+card.answer.totals[metric].unit,'meta'))
 if(!valid.length){outer.append(element('p','No values are available for this chart.'));return outer}
 const max=Math.max(...valid.map(row=>Math.abs(Number(row.values[metric].value))))
 const narrow=matchMedia('(max-width:760px)').matches,canvas=narrow?320:600,step=narrow?64:46
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg')
 svg.setAttribute('viewBox',`0 0 ${canvas} ${valid.length*step+8}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',label(metric)+' by '+(card.definition.groupBy.join(', ')||'total')+'. Exact values follow in the table.')
 for(const [i,row] of valid.entries()){
  const y=i*step+8,text=document.createElementNS(ns,'text');text.setAttribute('x','0');text.setAttribute('y',String(y+12));text.textContent=row.dimensions.join(' / ')||'Total';svg.append(text)
  const rect=document.createElementNS(ns,'rect');rect.setAttribute('x',narrow?'0':'190');rect.setAttribute('y',String(y+(narrow?24:0)));rect.setAttribute('width',String(max?Math.abs(Number(row.values[metric].value))/max*(narrow?210:280):0));rect.setAttribute('height','20');svg.append(rect)
  const value=document.createElementNS(ns,'text');value.setAttribute('x',narrow?'220':'480');value.setAttribute('y',String(y+(narrow?39:15)));value.textContent=figure(row.values[metric].value,row.values[metric].unit,card.context.currency);svg.append(value)
 }
 outer.append(svg)
 if(card.answer.rows.length>20)outer.append(element('p','Chart shows the first 20 groups. All exact groups remain in the table and warehouse export.','hint'))
 return outer
}
export function boardChoices(queries) {
 const choices=$('board-choices');choices.replaceChildren()
 for(const item of queries){const wrapper=element('label',undefined,'checkbox'),input=element('input');input.type='checkbox';input.name='queryIds';input.value=item.id;wrapper.append(input,document.createTextNode(item.label+' · '+stamp(item.created_at,zone)));choices.append(wrapper)}
 if(!queries.length)choices.append(element('p','Run and retain answers before combining them.','muted'))
}
export function renderBoard(result,request,action,status) {
 if(!result.cards)return false
 board=result;preview=undefined;$('warehouse-review').hidden=true;$('warehouse-send').disabled=true
 $('query-form').hidden=true;$('compose-form').hidden=true;$('answer').hidden=true;$('business-board').hidden=false
 $('board-title').textContent=result.title;$('board-note').textContent=`Saved ${result.kind} · ${stamp(result.createdAt,zone)} · ${result.cards.length} retained answers. Source windows and definitions remain separate.`
 $('board-cards').replaceChildren()
 for(const card of result.cards) {
  const section=element('section',undefined,'panel'),measures=Object.keys(card.answer.totals),heading=element('h3',card.definition.dataset)
  section.append(heading,element('p','Snapshot '+card.snapshotId+' · '+stamp(card.createdAt,zone),'meta'))
  for(const metric of measures)section.append(chart(card,metric))
  const shown=value=>value.state==='value'?figure(value.value,value.unit,card.context.currency):value.state.toUpperCase()
  section.append(table('Exact '+card.definition.dataset+' results',[...card.definition.groupBy.map(label),...measures.map(label)],card.answer.rows.map(row=>[...row.dimensions,...measures.map(metric=>shown(row.values[metric]))])))
  section.append(retainedExport(card.snapshotId))
  for(const source of card.provenance){const details=element('details'),summary=element('summary','Source: '+source.dataset+' · revision '+source.revision);details.append(summary,sourceView(source.source,source.updatedAt,zone));section.append(details)}
  const definition=element('details'),summary=element('summary','Exact query, definitions and source watermarks'),pre=element('pre',JSON.stringify({definition:card.definition,totals:card.answer.totals,watermarks:card.answer.sourceWatermarks,digest:card.digest},null,2));definition.append(summary,pre);section.append(definition)
  $('board-cards').append(section)
 }
 $('board-exact-note').textContent='These are immutable retained answers, not a common upstream snapshot or certified attribution rule. Vane goal-conversion visits, product usage and ledger revenue remain separate facts. No tracker or telemetry collector is installed.'
 $('board-report').onclick=()=>action(async()=>{const report=await request('reports',{queryIds:board.cards.map(card=>card.snapshotId),title:board.title}),link=element('a','Open cross-system report');link.href='/app/reports/'+report.id;$('board-report-link').replaceChildren(link);status('Report saved with these exact answer versions.')})
 const form=$('warehouse-form')
 form.oninput=()=>{preview=undefined;$('warehouse-review').hidden=true;$('warehouse-send').disabled=true;$('warehouse-confirm').checked=false}
 form.onsubmit=event=>{event.preventDefault();action(async()=>{
  const data=Object.fromEntries(new FormData(form));preview=await request('warehouse/preview',{...data,artifactId:board.id})
  $('warehouse-review').hidden=false;$('warehouse-destination').textContent=`${preview.destination.project}.${preview.destination.dataset}.${preview.destination.table} · ${preview.rowCount} rows · fingerprint ${preview.fingerprint}`
  const fields=['snapshot_id','metric','dimensions_json','value','unit','state'],payload=element('details'),summary=element('summary','Complete exact warehouse payload (all fields)'),pre=element('pre',JSON.stringify(preview.rows,null,2),'export-payload');payload.append(summary,pre)
  $('warehouse-rows').replaceChildren(table('Exact rows proposed for warehouse export',fields.map(label),preview.rows.map(row=>fields.map(field=>row[field]))),payload)
  $('warehouse-confirm').checked=false;$('warehouse-send').disabled=true;status('Review the exact destination and rows. No warehouse request has been made.')
 })}
 $('warehouse-confirm').onchange=()=>{$('warehouse-send').disabled=!preview||!$('warehouse-confirm').checked}
 $('warehouse-send').onclick=()=>action(async()=>{
  if(!preview||!$('warehouse-confirm').checked)throw Error('Review the exact export and confirm it first.')
  const accessToken=$('warehouse-token').value;$('warehouse-token').value=''
  const pending=preview;preview=undefined;$('warehouse-send').disabled=true;$('warehouse-send').dataset.previousDisabled='true';$('warehouse-confirm').checked=false
  const receipt=await request('warehouse/send',{id:pending.id,fingerprint:pending.fingerprint,accessToken,confirmExport:true})
  $('warehouse-outcome').textContent=receipt.state+': '+receipt.reason+' Receipt '+receipt.id
  const link=element('a','Open buyer warehouse table');link.href=receipt.link;link.rel='noreferrer';$('warehouse-link').replaceChildren(link);status(receipt.reason,receipt.state!=='acknowledged')
 })
 request('warehouse/history').then(history=>{$('warehouse-history').replaceChildren(table('Warehouse attempt history',['Receipt','State','Rows','Created'],history.exports.filter(item=>item.artifactId===board.id).map(item=>[item.id,item.state==='sending'?'in flight or unknown':item.state,item.rowCount,stamp(item.createdAt,zone)])))}).catch(error=>status(error.message,true))
 status('Cross-system result loaded with source links and exact tables.')
 return true
}
