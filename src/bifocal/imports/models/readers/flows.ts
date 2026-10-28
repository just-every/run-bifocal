import { issue } from './common'
import { readMFlow } from './flow-m'
import { readTableauFlow } from './flow-tableau'
import type { Project, ProjectFile } from './types'
import type { FlowResource } from './flow-types'

export function readFlows(project:Project,files:ProjectFile[]) {
 const resources:FlowResource[]=[]
 for(const file of files){
  const at={file:file.path,sourceExpression:file.content}
  if(!(project.format==='powerquery'?/\.(m|pq)$/i:/\.(tfl|tflx)$/i).test(file.path)){issue(project,at,file.path,'unsupported_flow_file','Supply the original M, PQ, TFL or TFLX file for the selected source format.');continue}
  const definition=project.format==='powerquery'?readMFlow(file):readTableauFlow(file)
  resources.push({...at,id:file.path,name:file.path,kind:'preparation-flow',dependencies:[],definition})
  for(const error of definition.errors)issue(project,at,file.path,error.code,error.message)
  for(const step of definition.steps){
   if(step.operation==='unsupported')issue(project,{file:file.path,sourceExpression:step.sourceExpression},step.id,step.code!,step.message!)
   if(step.operation==='source'){
    project.tables.push({file:file.path,sourceExpression:step.sourceExpression,name:step.id,sourceTable:null,dimensions:[],measures:[]})
    issue(project,{file:file.path,sourceExpression:step.sourceExpression},step.id,'flow_source_binding','Bind this original source step to an already reviewed file dataset. No imported source connection is opened.')
   }
  }
 }
 project.resources=resources
}
