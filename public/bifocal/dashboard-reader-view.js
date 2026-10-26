import {element,table} from './file-view.js'
import {figure,label,stamp} from './format.js'
import {retainedExport} from './retained-export.js'

export const readerLink=(text,path)=>{const a=element('a',text);a.href=path;return a}
export function readerButton(text,action){const b=element('button',text);b.type='button';b.onclick=action;return b}
export function readerField(text,control){const label=element('label',text);control.setAttribute('aria-label',text);label.append(control);return label}
export function readerSelect(text,values,selected){const select=element('select');for(const {value,label} of values){const option=element('option',label);option.value=value;option.selected=value===selected;select.append(option)}return {node:readerField(text,select),control:select}}
const shown=(value,currency)=>value.state==='value'?figure(value.value,value.unit,currency):value.state.toUpperCase()
const placed=(node,key,document,config)=>{for(const mode of ['desktop','phone']){const p=[...document.layout[mode],...config.tileLayout[mode]].find(p=>p.key===key);for(const name of ['x','y','w','h'])node.style.setProperty('--'+mode+'-'+name,String(p[name]))}}
export function dashboardReaderView({grid,config,document,zone,onFilter,onAction,onExport,onRecords}){
 const nodes=new Map(),lastGood=new Map()
 function section(key){if(nodes.has(key))return nodes.get(key);const node=element('section',undefined,'panel published-tile');node.dataset.cardKey=key;placed(node,key,document,config);grid.append(node);nodes.set(key,node);return node}
 function decoration(tile){const node=section(tile.key);node.replaceChildren();if(tile.kind==='text'){const text=element('p',tile.text,'dashboard-text-tile');node.append(text)}else{const img=element('img');img.alt=tile.alt;img.src=tile.data;img.loading='lazy';node.append(img)}}
 config.tiles.forEach(decoration)
 function update(result,{loading=false}={}){
  const tab=config.tabs.find(t=>t.id===result.selection.tab)
  for(const tile of config.tiles)section(tile.key).hidden=!tab.tiles.includes(tile.key)
  for(const card of result.cards){
   const node=section(card.key);node.hidden=!tab.cards.includes(card.key)
   if(!node.children.length){node.append(element('h2',card.key));const state=element('p',undefined,'meta');state.className+=' reader-tile-state';state.setAttribute('role','status');const data=element('div',undefined,'reader-values'),cross=element('details'),actions=element('div',undefined,'actions'),exports=element('div',undefined,'reader-exports');cross.className='reader-cross';cross.append(element('summary','Cross-filter from this tile'),element('div',undefined,'actions'));actions.className+=' reader-actions';node.append(state,data,cross,actions,exports);for(const action of config.actions.filter(a=>a.card===card.key))actions.append(readerButton(action.label,()=>onAction(action.id)));for(const action of config.recordActions??[])if(action.card===card.key)actions.append(readerButton(action.label,()=>onRecords(action.id)))}
   node.dataset.state=loading?'loading':card.status
   const state=node.querySelector('.reader-tile-state'),data=node.querySelector('.reader-values'),cross=node.querySelector('.reader-cross')
   if(loading){state.textContent='Loading current results';continue}
   if(card.status==='failed'){
    const last=lastGood.get(card.key);state.textContent='Failed · '+card.error+(last?' · Last successful '+stamp(last.at,zone):'')
    // Access and custody failures always withdraw copies. Other execution errors
    // retain explicitly dated last-good values from this open browser only.
    if(/permission|permitted|custody|changed|unavailable|not_found|scope|binding/.test(card.error)){data.replaceChildren();document.querySelectorAll('dialog.dashboard-reader-dialog').forEach(dialog=>dialog.remove());lastGood.delete(card.key);node.querySelector('.reader-exports').replaceChildren()}
    cross.hidden=true;continue
   }
   lastGood.set(card.key,{at:result.refreshedAt});state.textContent=label(card.status)+' · source observed '+stamp(card.observedAt,zone)+' · refreshed '+stamp(result.refreshedAt,zone)
   const measures=Object.keys(card.answer.totals),totals=element('dl',undefined,'published-totals')
   for(const id of measures){const item=element('div');item.append(element('dt',label(id)),element('dd',shown(card.answer.totals[id],card.context.currency)));totals.append(item)}
   const box=element('div',undefined,'published-table');box.append(table('Exact '+card.key+' results',[...card.definition.groupBy.map(label),...measures.map(label)],card.answer.rows.map(row=>[...row.dimensions,...measures.map(id=>shown(row.values[id],card.context.currency))])))
   const provenance=element('details');provenance.append(element('summary','Definition and source versions'),element('pre',JSON.stringify({definition:card.definition,watermarks:card.answer.sourceWatermarks},null,2)))
   data.replaceChildren(totals,box,provenance)

   if(card.scenario){const scenario=element('section',undefined,'dashboard-scenario');scenario.append(element('h3','What-if scenario'),element('p',card.scenario.binding.parameter+' = '+card.scenario.binding.value));const values=card.scenario.answer.formatted;scenario.append(table('Scenario '+card.key,[...card.definition.groupBy.map(label),...Object.keys(values.totals).map(label)],values.rows.map(row=>[...row.dimensions.map(String),...Object.keys(values.totals).map(id=>valuesValue(row.values[id]))])));const dl=element('dl',undefined,'published-totals');for(const [id,value] of Object.entries(values.totals)){const item=element('div');item.append(element('dt',label(id)),element('dd',valuesValue(value)));dl.append(item)}scenario.append(dl,element('p','Source actuals above remain unchanged.'));data.append(scenario)}
   const crossBox=cross.querySelector('div');crossBox.replaceChildren();const seen=new Set()
   for(const row of card.answer.rows)for(const [index,column] of card.definition.groupBy.entries())if(config.dimensions.includes(column)){const value=row.dimensions[index],key=JSON.stringify([column,value]);if(seen.has(key))continue;seen.add(key);crossBox.append(readerButton('Filter '+label(column)+' to '+String(value??'empty'),()=>onFilter(column,value)))}
   cross.hidden=!crossBox.children.length
   const exports=node.querySelector('.reader-exports'),fingerprint=JSON.stringify([card.answer.definitionHash,card.answer.sourceWatermarks]);if(exports.dataset.fingerprint!==fingerprint){exports.replaceChildren(...onExport?[readerButton('Prepare current exports',()=>onExport(card,exports))]:[]);exports.dataset.fingerprint=fingerprint}
  }
 }
 return {update,clear(){grid.replaceChildren();nodes.clear();lastGood.clear()},exported(box,id){box.replaceChildren(retainedExport(id))}}
}
const valuesValue=value=>value===null?'NULL':String(value)
export function tooltipView(result){const dialog=element('dialog',undefined,'dashboard-reader-dialog'),close=readerButton('Close tooltip',()=>{dialog.close();dialog.remove()});dialog.append(element('h2',result.title),close);for(const card of result.cards){const section=element('section');section.append(element('h3',card.key));if(card.answer){const measures=Object.keys(card.answer.totals);section.append(table('Tooltip '+card.key,[...card.definition.groupBy.map(label),...measures.map(label)],card.answer.rows.map(row=>[...row.dimensions,...measures.map(id=>shown(row.values[id],card.context.currency))])))}else section.append(element('p','Unavailable: '+card.error));dialog.append(section)}document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();close.focus()}
export function sourceRecordsView(result,read){
 const dialog=element('dialog',undefined,'dashboard-reader-dialog'),heading=element('h2',result.title),status=element('p'),content=element('div',undefined,'published-table'),actions=element('div',undefined,'actions'),close=readerButton('Close source records',()=>dialog.close())
 status.setAttribute('role','status');dialog.append(heading,close,status,content,actions)
 const show=async(page)=>{heading.textContent=page.record?'Source record '+page.keys.map(key=>String(page.record[key])).join(' · '):page.title;status.textContent=page.dataset+' · '+page.totalRows+' record'+(page.totalRows===1?'':'s')+' in current scope · source revision '+page.sourceRevision;content.replaceChildren(table('Protected source records',page.columns,page.rows.map(row=>page.columns.map(column=>row[column]))));actions.replaceChildren();if(page.record)actions.append(readerButton('Back to scoped records',()=>load()));else{for(const row of page.rows){const record=Object.fromEntries(page.keys.map(key=>[key,row[key]]));actions.append(readerButton('Open record '+page.keys.map(key=>String(row[key])).join(' · '),()=>load(record)))}if(page.offset>0)actions.append(readerButton('Previous source records',()=>load(undefined,Math.max(0,page.offset-25))));if(page.nextOffset!==null)actions.append(readerButton('Next source records',()=>load(undefined,page.nextOffset)))}const context=element('details');context.append(element('summary','Named record and filter context'),element('pre',JSON.stringify({record:page.record,selection:page.selection,inherited:page.inherited,sourceWatermarks:page.sourceWatermarks},null,2)));content.append(context)}
 async function load(record,offset=0){try{await show(await read(record,offset))}catch(error){content.replaceChildren();actions.replaceChildren();status.textContent=error.message;status.setAttribute('role','alert')}}
 show(result);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();close.focus()
}
