import {metadata,table} from './file-view.js'

export function preparationFlow(preparationId,useDocument){
 const $=id=>document.getElementById(id),button=$('prep-flow-load')
 let busy=false
 button.addEventListener('click',async()=>{
  if(busy)return
  busy=true;button.disabled=true
  try{
   const id=preparationId(),projectId=$('prep-flow-project').value
   if(!/^[a-z][a-z0-9-]{0,63}$/.test(projectId))throw Error('Enter an imported project ID.')
   const response=await fetch('/api/operator/model-imports/'+projectId),project=await response.json()
   if(!response.ok)throw Error(project.error)
   const flowId=$('prep-flow-id').value,bindings=JSON.parse($('prep-flow-bindings').value)
   const reviewed=await fetch('/api/operator/preparations/'+id+'/flow-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,revision:project.revision,bindings,...flowId?{flowId}:{}})}),value=await reviewed.json()
   if(!reviewed.ok)throw Error(value.error)
   $('prep-flow-report').replaceChildren(metadata([['Original project',projectId],['Original revision',project.revision],['Flow',value.imported.flowId],['Translation',value.compatible?'Supported native subset':'Unresolved steps block native loading'],['Original output equivalence',value.equivalence.status],['Output order',value.ordering]]),table('Original preparation step mappings',['Source step','Original location','Original expression','Dependencies','Status','Input schema','Output schema','Native steps'],value.steps.map(step=>[step.name,step.location.file+':'+step.location.line+':'+step.location.column+(step.location.pointer?' · '+step.location.pointer:''),step.sourceExpression,step.dependencies.join(', '),step.status,JSON.stringify(step.inputSchema),JSON.stringify(step.outputSchema),JSON.stringify(step.nativeSteps)])),table('Original preparation diagnostics',['Source step','Reason','Required work'],value.diagnostics.map(item=>[item.resource,item.code,item.message])))
   if(value.compatible&&value.document){useDocument(value.document);$('prep-flow-status').textContent='Supported flow loaded as native steps. Original output equivalence remains unverified.'}
   else $('prep-flow-status').textContent='Flow unresolved. Inspect every source step and required work; the current native draft is unchanged.'
  }catch(error){$('prep-flow-report').replaceChildren();$('prep-flow-status').textContent='Flow unavailable: '+error.message}
  finally{busy=false;button.disabled=false}
 })
}
