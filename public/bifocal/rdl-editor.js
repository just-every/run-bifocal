const $=id=>document.getElementById(id)
let project=null,submit=null,items=[],busy=false
export function setRdlEditor(current,review){
 project=current;submit=review;items=[];$('rdl-editor-location').replaceChildren();$('rdl-editor').hidden=!current
 if(!current)return
 for(const report of current.definition.reports){
  const visit=(node,box)=>{if(node.name==='Textbox')box=node.attributes.Name;for(const child of node.children){if(child.name==='Value'&&!child.children.length&&box&&['Textbox','TextRun'].includes(node.name))items.push({file:report.file,location:child.location,value:child.text,label:report.file+' · '+box});visit(child,box)}}
  visit(report.tree,null)
 }
 for(const item of items){const option=document.createElement('option');option.value=item.location;option.textContent=item.label;$('rdl-editor-location').append(option)}
 $('rdl-editor-value').value=items[0]?.value??'';$('rdl-editor-status').textContent=items.length?'Select a text box to edit.':'This draft has no supported editable text boxes.';$('rdl-editor-form').querySelector('button').disabled=!items.length
}
if($('rdl-editor-form')){
 $('rdl-editor-location').addEventListener('change',()=>{$('rdl-editor-value').value=items.find(item=>item.location===$('rdl-editor-location').value)?.value??''})
 $('rdl-editor-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!project||!submit)return;busy=true
  try{
   const item=items.find(item=>item.location===$('rdl-editor-location').value);if(!item)throw Error('Select a current report text box.')
   const input=structuredClone(project.input),file=input.files.find(file=>file.path===item.file),document=new DOMParser().parseFromString(file.content,'application/xml')
   if(document.querySelector('parsererror'))throw Error('Reload a valid report definition.')
   const segments=item.location.slice(item.file.length+2).split('/');let node=document.documentElement
   if(segments.shift()!=='Report[1]')throw Error('Reload the current text box location.')
   for(const segment of segments){const match=/^([^\[]+)\[(\d+)\]$/.exec(segment);if(!match)throw Error('Reload the current text box location.');node=Array.from(node.children).filter(child=>child.tagName===match[1])[Number(match[2])-1];if(!node)throw Error('Reload the current text box location.')}
   if(node.localName!=='Value'||!['Textbox','TextRun'].includes(node.parentElement?.localName))throw Error('Select an editable text box value.')
   node.textContent=$('rdl-editor-value').value;file.content=new XMLSerializer().serializeToString(document);delete file.originalBase64
   await submit(input,project.revision);$('rdl-editor-status').textContent='Edit staged. Review the exact draft and unresolved items before importing.'
  }catch(error){$('rdl-editor-status').textContent='Report edit unavailable: '+error.message}finally{busy=false}
 })
}
