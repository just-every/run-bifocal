import {element,table} from './file-view.js'

export function showPreparationImports(box,project){
 if(!project.preparation)return
 for(const flow of project.preparation){
  const section=element('section'),title=element('h3',flow.name)
  section.append(title,table('Preparation step translations',['Source step','Source location','Status','Source rows','Reason','Affected downstream items'],flow.steps.map(s=>[s.name,s.location,s.status,s.rowEquivalence,s.reason??'',s.affectedDownstream.join(', ')])))
  for(const step of flow.steps){
   const detail=element('details'),summary=element('summary',step.name+' · '+step.status),expression=element('pre',step.sourceExpression)
   detail.append(summary,element('p','Remediation owner: '+step.remediationOwner+'. Source row equivalence: '+step.rowEquivalence+'.'),expression)
   if(step.inputSchema)detail.append(table('Input schema: '+step.name,['Column','Type'],step.inputSchema.map(c=>[c.name,c.type])))
   if(step.outputSchema)detail.append(table('Output schema: '+step.name,['Column','Type'],step.outputSchema.map(c=>[c.name,c.type])))
   if(step.comparison)detail.append(element('pre',JSON.stringify(step.comparison,null,2)))
   if(step.executable)detail.append(element('pre',JSON.stringify(step.executable,null,2)))
   if(step.output)detail.append(table('Complete step output: '+step.name,step.output.columns.map(c=>c.name),step.output.rows.map(row=>row.map(value=>value===null?'NULL':String(value)))))
   section.append(detail)
  }
  box.append(section)
 }
}
export function preparationImportActions(box,current,projectId,perform,status){
 if(!current.preparation)return
 for(const flow of current.preparation){
  const button=element('button','Edit translated flow: '+flow.name);button.type='button';button.disabled=!current.report.compatible||!flow.compatible||!flow.document
  button.addEventListener('click',perform(async()=>{
   const r=await fetch('/api/operator/model-imports/'+projectId+'/preparation',{method:'POST',headers:{'content-type':'application'+'/'+'json'},body:JSON.stringify({reviewedRevision:current.revision,flow:flow.id})})
   const value=await r.json();if(!r.ok)throw Error(value.error)
   document.dispatchEvent(new CustomEvent('bifocal-preparation-import',{detail:{...value,id:projectId}}))
   document.getElementById('preparation').scrollIntoView({behavior:'smooth'});status('Translated flow opened as a native preparation draft. Review before saving.')
  }))
  box.append(button)
 }
}
