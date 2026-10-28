const $=id=>document.getElementById(id)
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text??'—');return e}
export function mountComposition(views){
 const form=$('composition-form');if(!form)return null
 let result,scope='summary',offset=0,next=null,pending=false,fullPlan,fullOffset=0,fullDownloaded=0
 const status=(message,error=false)=>{$('composition-status').textContent=message;$('composition-status').dataset.error=String(error)}
 const request=async(path,data)=>{const response=await fetch('/api/operator/explore/compositions'+path,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json'},...data===undefined?{}:{body:JSON.stringify(data)}}),body=await response.json();if(!response.ok)throw Error(String(body.error??'Composition unavailable').replaceAll('_',' '));return body}
 const action=async(work)=>{if(pending)return;pending=true;form.inert=true;$('composition-result').inert=true;form.setAttribute('aria-busy','true');try{await work()}catch(error){if(!error.keepResult)$('composition-result').hidden=true;status(error.message,true)}finally{pending=false;form.inert=false;$('composition-result').inert=false;form.removeAttribute('aria-busy')}}
 const resetFullExport=()=>{fullPlan=null;fullOffset=0;fullDownloaded=0;$('composition-full-export').hidden=true}
 const fullNote=()=>{$('composition-full-export-note').textContent=fullDownloaded+' of '+fullPlan.totalRows+' rows downloaded. This complete export has '+fullPlan.parts+' named parts with headers and up to '+fullPlan.partRows+' rows each. '+(fullOffset===null?'Every part has been offered for download.':'Download the next part to continue.');$('composition-full-export-next').disabled=fullOffset===null}
 const offerFullExport=plan=>{fullPlan=plan;fullOffset=0;fullDownloaded=0;$('composition-full-export').hidden=false;fullNote()}
 for(const side of ['left','right']){
  const select=$('compose-'+side);views.forEach((view,index)=>{if(!view.grantId)select.add(new Option(view.viewId+' · '+view.modelId.slice(0,8),String(index)))})
  const keys=()=>{const view=views[Number(select.value)],target=$('compose-'+side+'-key');target.replaceChildren();for(const dimension of view?.dimensions??[])if(!dimension.column.includes('.')||dimension.column.startsWith('base.'))target.add(new Option(dimension.column,dimension.column))}
  select.onchange=keys;keys()
 }
 const setLimits=async()=>{const response=await fetch('/api/operator/explore'),catalog=await response.json();if(!response.ok)throw Error('Current export limits unavailable');$('composition-limits').textContent='Interactive limits: '+catalog.limits.csv+' CSV rows and '+catalog.limits.xlsx+' XLSX rows.'}
 const sourceLink=(value,column)=>{if(typeof value!=='string'||!column.endsWith('source_url'))return null;try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)return null;const a=element('a','Open source');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';return a}catch{return null}}
 const render=async()=>{
  const data=await request('/'+result.id+'/page',{scope,offset});next=data.nextOffset
  const wrap=element('div');wrap.className='tablewrap';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',scope==='summary'?'Combined summary':'Combined underlying rows')
  const table=element('table'),head=element('thead'),header=element('tr');table.append(element('caption',scope==='summary'?'Combined summary':'Combined underlying rows'));for(const column of data.columns){const cell=element('th',column.name);cell.scope='col';header.append(cell)}head.append(header);table.append(head)
  const body=element('tbody');for(const row of data.rows){const line=element('tr');row.forEach((value,index)=>{const cell=element('td');cell.append(sourceLink(value,data.columns[index].name)||element('span',value));line.append(cell)});body.append(line)}table.append(body);wrap.append(table);$('composition-table').replaceChildren(wrap)
  $('composition-page').textContent='Showing '+(data.rows.length?offset+1:0)+'–'+(offset+data.rows.length)+' of '+data.totalRows+' '+scope+' rows.';$('compose-previous').disabled=offset===0;$('compose-next').disabled=next===null
  $('compose-summary').setAttribute('aria-pressed',String(scope==='summary'));$('compose-underlying').setAttribute('aria-pressed',String(scope==='underlying'))
 }
 const show=async()=>{
  resetFullExport()
  $('composition-result').hidden=false;$('composition-diagnostics').textContent=JSON.stringify(result.diagnostics,null,2)
  $('composition-totals').replaceChildren();for(const side of ['left','right']){const section=element('section');section.append(element('h4',side==='left'?'Left subject totals':'Right subject totals'));const values=element('dl');for(const [name,value] of Object.entries(result.totals[side]))values.append(element('dt',name),element('dd',value.value??value.state));section.append(values);$('composition-totals').append(section)}
  $('composition-saved').href='/app/questions/compositions/'+result.id;await render();await setLimits();status('Combined question saved with exact subject scopes and current permissions.')
 }
 const sideParameters=side=>{const view=views[Number($('compose-'+side).value)];if(!view)throw Error('Choose both permitted subjects');return {modelId:view.modelId,revision:view.revision,viewId:view.viewId,groupBy:[$('compose-'+side+'-key').value],filters:[]}}
 form.onsubmit=event=>{event.preventDefault();action(async()=>{result=await request('/run',{left:sideParameters('left'),right:sideParameters('right'),operation:$('compose-operation').value,join:$('compose-join').value});scope='summary';offset=0;await show()})}
 for(const value of ['summary','underlying'])$('compose-'+value).onclick=()=>action(async()=>{resetFullExport();scope=value;offset=0;await render();status('Combined question scope changed.')})
 $('compose-previous').onclick=()=>action(async()=>{offset=Math.max(0,offset-25);await render()});$('compose-next').onclick=()=>action(async()=>{if(next!==null){offset=next;await render()}})
 for(const format of ['csv','xlsx'])$('compose-'+format).onclick=()=>action(async()=>{resetFullExport();await setLimits();const response=await fetch('/api/operator/explore/compositions/'+result.id+'/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope,format})});if(!response.ok){const error=await response.json();if(response.status===413&&error.fullExport){offerFullExport(error.fullExport);status('This combined result exceeds the interactive limit. Download every named part for the complete export.');return}throw Error(String(error.error).replaceAll('_',' '))}const url=URL.createObjectURL(await response.blob()),link=element('a');link.href=url;link.download='bifocal-combined-'+scope+'.'+format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Combined export complete: '+response.headers.get('x-bifocal-row-count')+' '+scope+' rows.')})
 $('composition-full-export-next').onclick=()=>action(async()=>{
  if(!fullPlan||fullOffset===null)return
  await setLimits()
  const response=await fetch('/api/operator/explore/compositions/'+fullPlan.snapshotId+'/full-export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:fullPlan.scope,format:fullPlan.format,offset:fullOffset,planDigest:fullPlan.planDigest})})
  if(!response.ok){const body=await response.json(),error=Error(String(body.error).replaceAll('_',' ')+'. Prepare a fresh complete export using the current limits and permissions.');error.keepResult=body.error==='full_export_plan_changed';resetFullExport();throw error}
  const count=Number(response.headers.get('x-bifocal-row-count')),next=response.headers.get('x-bifocal-next-offset'),part=Math.floor(fullOffset/fullPlan.partRows)+1
  if(!Number.isSafeInteger(count)||count<0||next===null)throw Error('Export part metadata is incomplete. Prepare a fresh complete export.')
  const url=URL.createObjectURL(await response.blob()),link=element('a');link.href=url;link.download='bifocal-combined-'+fullPlan.scope+'-part-'+part+'.'+fullPlan.format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  fullDownloaded+=count;fullOffset=next===''?null:Number(next);fullNote();status(fullOffset===null?'Complete combined export: every part downloaded.':'Combined export part downloaded. Continue with the next named part.')
 })
 return {open:id=>action(async()=>{result=await request('/'+id);scope='summary';offset=0;$('composition').open=true;await show()})}
}
