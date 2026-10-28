import {element,metadata,table} from './file-view.js'

export function preparationPublication(head){
 const $=id=>document.getElementById(id),input=$('prep-output-id'),result=$('prep-publish-result'),confirm=$('prep-publish-confirm'),publish=$('prep-publish')
 let reviewed=null,busy=false
 const status=message=>{$('prep-publish-status').textContent=message}
 const reset=()=>{reviewed=null;result.hidden=true;confirm.checked=false;publish.disabled=true}
 const call=async(action,body)=>{
  const current=head()
  if(!current.id||!current.version)throw Error('Load a saved preparation first.')
  const response=await fetch('/api/operator/preparations/'+current.id+'/'+action,{method:'POST',headers:{'content-type':'application'+'/'+'json'},body:JSON.stringify(body)}),value=await response.json()
  if(!response.ok)throw Error(value.reason??value.error)
  return value
 }
 const perform=async work=>{if(busy)return;busy=true;$('prep-publish-review').disabled=true;publish.disabled=true;input.disabled=true;try{await work()}catch(error){reset();status('Publication unavailable: '+error.message)}finally{busy=false;input.disabled=false;$('prep-publish-review').disabled=false;publish.disabled=!reviewed||!confirm.checked}}
 input.addEventListener('input',reset)
 confirm.addEventListener('change',()=>{publish.disabled=busy||!reviewed||!confirm.checked})
 $('prep-publish-review').addEventListener('click',()=>perform(async()=>{
  reset()
  const dataset=input.value
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(dataset))throw Error('Enter a new prepared dataset ID.')
  const value=await call('publish-review',{dataset,version:head().version}),box=$('prep-publish-report')
  box.replaceChildren(metadata([['New dataset',value.dataset],['Saved preparation version',value.version],['Reviewed digest',value.digest],['Execution','Explicit bounded native action'],['Existing certified definitions','Unchanged']]),table('Publication source revisions',['Dataset','Revision'],value.sources.map(source=>[source.dataset,source.revision])),table('Publication column lineage',['Column','Type','Source dataset','Source revision','Source column'],value.output.columns.flatMap(column=>value.output.lineage[column.name].map(ref=>[column.name,column.type,ref.dataset,ref.revision,ref.column]))))
  const output=element('div'),count=element('p'),actions=element('div',undefined,'actions'),previous=element('button','Previous publication rows'),next=element('button','Next publication rows')
  let page=0
  previous.type=next.type='button'
  const render=()=>{const start=page*100,end=Math.min(start+100,value.output.rows.length);count.textContent=`${value.output.rows.length} complete output rows. Showing ${value.output.rows.length?start+1:0}–${end}. NULL is shown explicitly.`;output.replaceChildren(table('Publication output rows',value.output.columns.map(column=>column.name),value.output.rows.slice(start,end)));previous.disabled=page===0;next.disabled=end>=value.output.rows.length}
  previous.onclick=()=>{page--;render()};next.onclick=()=>{page++;render()};actions.append(previous,next);box.append(count,output,actions);render()
  reviewed={...value,id:head().id};result.hidden=false;status('Saved output reviewed. Confirm this exact version to publish a new dataset.')
 }))
 publish.addEventListener('click',()=>perform(async()=>{
  if(!reviewed||!confirm.checked||reviewed.id!==head().id||reviewed.version!==head().version)throw Error('Review the saved output again.')
  const value=await call('publish',{dataset:reviewed.dataset,version:reviewed.version,reviewedDigest:reviewed.digest})
  reset();status('Prepared dataset '+value.dataset+' published from revision '+value.version+'. Existing certified metrics and source records are unchanged.')
 }))
 return {reset}
}
