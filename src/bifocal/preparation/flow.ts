import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Column } from '../imports/files/csv'
import type { ProjectResource } from '../imports/models/readers/types'
import type { FlowDefinition, FlowStep } from '../imports/models/readers/flow-types'
import { executePreparation, type Preparation } from './execute'
import { preparationDecimal } from './decimal'
import { fail, QueryError, type Source } from '../query/types'

export type FlowBindings=Record<string,string>
export type FlowInput={projectId:string;revision:string;resources:ProjectResource[];bindings:FlowBindings;flowId?:string}
type Frame=NonNullable<ReturnType<typeof executePreparation>['output']>
type StepReport=FlowStep&{status:'translated'|'unsupported'|'dependency-blocked'|'failed';inputSchema:Column[]|null;outputSchema:Column[]|null;inputRows:number|null;outputRows:number|null;output:Frame|null}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export function flowBindings(value:unknown):FlowBindings {
 if(!object(value)||Object.keys(value).length>64||Object.entries(value).some(([key,dataset])=>!key||key.length>512||/[\u0000-\u001f]/.test(key)||typeof dataset!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(dataset)))fail('flow_source_bindings_required',400)
 return value as FlowBindings
}
export const flowDatasets=(bindings:FlowBindings)=>[...new Set(Object.values(bindings))].sort()

function canonicalCast(frame:Frame,step:Record<string,unknown>):boolean {
 const index=frame.columns.findIndex(c=>c.name===step.column)
 if(index<0)return false
 const from=frame.columns[index].type,to=String(step.type)
 // Culture-sensitive parsing, decimal rounding and implicit formatting are
 // explicit gaps. Only representations with matching native semantics pass.
 if(to==='text')return from==='text'||from==='boolean'
 if(to==='boolean')return from==='boolean'||from==='text'&&frame.rows.every(r=>r[index]===null||r[index]==='true'||r[index]==='false')
 if(to==='date')return (from==='date'||from==='text')&&frame.rows.every(r=>r[index]===null||typeof r[index]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r[index] as string))
 if(to!=='number'||!['number','money','text'].includes(from))return false
 return frame.rows.every(row=>{
  if(row[index]===null)return true
  try{
   const d=preparationDecimal(row[index]);let denominator=d.denominator,numerator=d.numerator<0n?-d.numerator:d.numerator
   while(denominator%2n===0n)denominator/=2n
   if(denominator!==1n||numerator>d.denominator*9007199254740991n)return false
   while(numerator&&numerator%2n===0n)numerator/=2n
   return numerator.toString(2).length<=53
  }catch{return false}
 })
}

/** Original expressions are inert; execution uses only native preparation ops
 * against explicit owner-authorized snapshots supplied by the server. */
export function executeFlow(input:FlowInput,sources:Source[]) {
 const bindings=flowBindings(input.bindings),resources=input.resources.filter(r=>r.kind==='preparation-flow')
 const selected=input.flowId?resources.filter(r=>r.id===input.flowId):resources
 const diagnostics:{resource:string;code:string;message:string}[]=[],reports:StepReport[]=[]
 let document:Preparation|null=null,output:Frame|null=null,previewBytes=0
 const used=new Map<string,string>()
 const problem=(resource:string,code:string,message:string)=>diagnostics.push({resource,code,message})
 if(selected.length!==1)problem(input.flowId??'project','one_flow_required','Select one included original flow. Each flow has a separate preparation output.')
 const resource=selected.length===1?selected[0]:null
 const definition=resource?.definition as FlowDefinition|undefined
 if(resource&&(!definition||!Array.isArray(definition.steps)||!Array.isArray(definition.errors)||definition.steps.length>256))problem(resource.id,'invalid_flow_resource','Reload a bounded original flow through the shared import door.')
 else if(resource&&definition){
  for(const error of definition.errors)problem(resource.id,error.code,error.message)
  const frames=new Map<string,Frame>(),documents=new Map<string,Preparation>()
  const ids=new Set(definition.steps.map(s=>s.id))
  for(const key of Object.keys(bindings))if(!definition.steps.some(s=>s.id===key&&s.operation==='source'))problem(key,'unknown_flow_source_binding','Bind only an original source step in the selected flow.')
  for(const step of definition.steps){
   const report:StepReport={...step,status:'unsupported',inputSchema:null,outputSchema:null,inputRows:null,outputRows:null,output:null};reports.push(report)
   const dependency=step.dependencies.length===1?frames.get(step.dependencies[0]):undefined
   if(dependency){report.inputSchema=structuredClone(dependency.columns);report.inputRows=dependency.rows.length}
   if(step.operation==='unsupported'){
    problem(step.id,step.code??'unsupported_flow_step',step.message??'This original step requires translation before downstream publication.');continue
   }
   if(step.dependencies.some(id=>!ids.has(id)||!frames.has(id))){report.status='dependency-blocked';problem(step.id,'flow_dependency_blocked','An upstream source step is unresolved; no downstream expression is executed.');continue}
   try{
    let candidate:Preparation
    if(step.operation==='source'){
     const dataset=bindings[step.id],source=sources.find(s=>s.id===dataset)
     if(!source){report.status='failed';problem(step.id,'flow_source_binding_required','Bind this original source to an already reviewed file dataset.');continue}
     if(step.dependencies.length)fail('flow_source_dependency_refused')
     if(step.sourceSchema&&canonicalJson(step.sourceSchema)!==canonicalJson(source.table.columns))fail('flow_source_schema_mismatch')
     used.set(source.id,source.revision);candidate={version:1,dataset:source.id,steps:[]}
    }else {
     const previous=step.dependencies.length===1?documents.get(step.dependencies[0]):undefined
     if(!previous||!dependency)fail('flow_sequential_dependency_required')
     candidate={...previous,steps:[...previous.steps,...step.nativeSteps]}
     if(candidate.steps.length>32)fail('flow_native_step_limit',413)
     let working=dependency;const applied:Record<string,unknown>[]=[]
     for(const nativeStep of step.nativeSteps){
      if(nativeStep.op==='cast'&&!canonicalCast(working,nativeStep))fail('flow_canonical_conversion_required')
      applied.push(nativeStep)
      const interim=executePreparation({...previous,steps:[...previous.steps,...applied]},sources)
      if(!interim.compatible||!interim.output)fail(interim.error?.code??'flow_step_failed')
      working=interim.output
     }
    }
    const result=executePreparation(candidate,sources)
    if(!result.compatible||!result.output)fail(result.error?.code??'flow_step_failed')
    previewBytes+=new TextEncoder().encode(canonicalJson(result.output)).length
    if(previewBytes>4194304)fail('flow_step_preview_limit',413)
    const frame=result.output
    frames.set(step.id,frame);documents.set(step.id,candidate)
    Object.assign(report,{status:'translated',outputSchema:structuredClone(frame.columns),outputRows:frame.rows.length,output:frame})
   }catch(error){report.status='failed';problem(step.id,error instanceof QueryError?error.code:'flow_step_failed','This original step cannot produce a safe equivalent native result. Review its source types, values and supported conversion semantics.')}
  }
  if(!definition.output||!frames.has(definition.output))problem(resource.id,'flow_output_unavailable','The final original output depends on unresolved or missing steps.')
  if(!diagnostics.length&&definition.output){document=documents.get(definition.output)??null;output=frames.get(definition.output)??null}
 }
 return {compatible:!!document&&!diagnostics.length,document,output,steps:reports,diagnostics,sources:[...used].map(([dataset,revision])=>({dataset,revision})),imported:{projectId:input.projectId,revision:input.revision,flowId:resource?.id??null},counts:{total:reports.length,translated:reports.filter(s=>s.status==='translated').length,unsupported:reports.filter(s=>s.status==='unsupported').length,dependencyBlocked:reports.filter(s=>s.status==='dependency-blocked').length,failed:reports.filter(s=>s.status==='failed').length},equivalence:{status:'unverified',reason:'Original per-step output snapshots have not been supplied for comparison.'},ordering:reports.some(s=>s.operation==='dedupe')?'unspecified':'source-order'}
}
export const reviewFlow=executeFlow
