import { readPowerQuery } from './readers/preparation/m-reader'
import { readPrep } from './readers/preparation/prep'
import { prepDocuments } from './readers/preparation/archive'
import type { SourceFlow, PreparationFormat, FlowStep } from './readers/preparation/types'
import type { Project, ProjectFile } from './readers/types'
import type { Source } from '../../query/types'
import type { Binding, ModelImportInput } from './compile'
import { executePreparation, preparationInput, type Preparation, type Frame } from '../../preparation/execute'
import { preparationSQL } from '../../preparation/sql'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'

export const preparationFormats=['powerquery','dataflow-gen1','dataflow-gen2','prep'] as const
export type StepReport = FlowStep & {status:'translated'|'unsupported'|'blocked'|'parameter';reason?:string;affectedDownstream:string[];remediationOwner:'installation-owner';inputSchema:Frame['columns']|null;outputSchema:Frame['columns']|null;executable:Record<string,unknown>[]|null;output:Frame|null;rowEquivalence:'not-supplied';document:Preparation|null}
export type FlowReport={id:string;name:string;result:string;steps:StepReport[];compatible:boolean;document:Preparation|null;sql:string|null;output:Frame|null;metadata?:Record<string,unknown>}
export function readPreparation(format:PreparationFormat,files:ProjectFile[]):SourceFlow[]{
 if(format!=='prep')return readPowerQuery(files,format)
 const documents=prepDocuments(files)
 return [...readPrep(documents.files),...documents.gaps]
}
export function preparationProject(format:PreparationFormat,files:ProjectFile[]):Project {
 const flows=readPreparation(format,files)
 return {format,tables:[],explores:[],issues:[],resources:flows.flatMap(flow=>flow.steps.map(step=>({id:flow.id+'::'+step.id,name:step.name,kind:'preparation-step',file:step.file,sourceExpression:step.sourceExpression,dependencies:step.dependencies,definition:{flow:flow.id,location:step.location,...step.parameter?{parameter:step.parameter}:{},...step.metadata?{metadata:step.metadata}:{}}})))}
}
function bindingDocument(binding:Binding|undefined,sources:Source[]):Preparation|null {
 if(!binding||Object.keys(binding).some(k=>!['dataset','grain','columns'].includes(k))||!sources.some(s=>s.id===binding.dataset))return null
 // Column renames are source operations. Implicit binding aliases would hide a
 // source step and are refused for this intake.
 if(binding.columns&&Object.entries(binding.columns).some(([a,b])=>a!==b))return null
 return {version:1,dataset:binding.dataset,steps:[]}
}
export function compilePreparation(input:ModelImportInput,sources:Source[]):FlowReport[]{
 const flows=readPreparation(input.format as PreparationFormat,input.files)
 return flows.map(flow=>{
  const reports=new Map<string,StepReport>(),visiting=new Set<string>(),steps=input.format==='prep'?flow.steps:flows.flatMap(f=>f.steps)
  const descendant=(id:string):string[]=>{const seen=new Set<string>(),pending=[id];while(pending.length){const at=pending.pop()!;for(const s of steps)if(s.dependencies.includes(at)&&!seen.has(s.id)){seen.add(s.id);pending.push(s.id)}}return [...seen]}
  const inspect=(step:FlowStep):StepReport=>{
   const existing=reports.get(step.id);if(existing)return existing
   const report:StepReport={...step,status:'unsupported',affectedDownstream:descendant(step.id),remediationOwner:'installation-owner',inputSchema:null,outputSchema:null,executable:null,output:null,rowEquivalence:'not-supplied',document:null}
   if(visiting.has(step.id)){report.reason='Cyclic preparation dependency.';return report}
   visiting.add(step.id)
   const dependencies=step.dependencies.map(id=>{const found=steps.find(s=>s.id===id);return found?inspect(found):null})
   const tables=dependencies.filter((d):d is StepReport=>!!d&&d.status!=='parameter')
   if(step.parameter){report.status=step.reason?'unsupported':'parameter'}
   else if(step.reason)report.reason=step.reason
   else if(dependencies.some(d=>!d||!['translated','parameter'].includes(d.status))){report.status='blocked';report.reason='Resolve missing, cyclic or unsupported upstream items: '+step.dependencies.join(', ')}
   else {
    let document=step.binding?bindingDocument(input.bindings[step.binding],sources):tables[0]?.document?structuredClone(tables[0].document):null
    report.inputSchema=tables[0]?.outputSchema??(document?sources.find(s=>s.id===document!.dataset)!.table.columns:null)
    try{
     if(!document)throw Error('Map this inactive source reference to a reviewed dataset using binding '+(step.binding??step.name)+'.')
     if(step.binding&&step.operations===undefined)step={...step,operations:[]}
     if(step.operations===undefined)throw Error('No executable translation is available for this source construct.')
     const operations=structuredClone(step.operations)
     for(const op of operations)if(typeof op.dataset==='string'&&op.dataset.startsWith('$step:')){
      const other=steps.find(s=>s.id===String(op.dataset).slice(6)),resolved=other?inspect(other):null
      if(!resolved?.document||resolved.document.steps.length)throw Error('This multi-branch transformation needs a faithful native graph rewrite; no intermediate source is substituted.')
      op.dataset=resolved.document.dataset
     }
     const before=executePreparation(document,sources)
     if(!before.compatible)throw Error('Upstream native execution failed.')
     if(step.metadata?.requiresConversionEquivalence){
      for(const op of operations)if(op.op==='cast'&&before.output!.columns.find(c=>c.name===op.column)?.type!==op.type)throw Error('Source type conversion requires independently supplied source output and faithful culture semantics; only unchanged primitive types are translated here.')
     }
     if(step.metadata?.requiresSortEquivalence){
      for(const op of operations)if(op.op==='sort'&&(op.columns as {column:string}[]).some(c=>before.output!.columns.find(x=>x.name===c.column)?.type==='text'))throw Error('Culture-sensitive text sort requires an explicit faithful comparator; ordinal ordering is not substituted.')
     }
     document=preparationInput({...document,steps:[...document.steps,...operations]})
     const result=executePreparation(document,sources)
     if(!result.compatible)throw Error('Native step refused: '+result.error!.code)
     report.status='translated';report.document=document;report.executable=operations;report.output=result.output;report.outputSchema=result.output!.columns
    }catch(error){report.reason=error instanceof Error?error.message:'Native preparation rejected.'}
   }
   visiting.delete(step.id);reports.set(step.id,report);return report
  }
  const all=flow.steps.map(inspect)
  for(const duplicate of steps.filter((s,i)=>steps.findIndex(o=>o.id===s.id)!==i)){const item=reports.get(duplicate.id)!;item.status='unsupported';item.reason='Duplicate source step identity.'}
  const result=reports.get(flow.result),parameterOnly=!!result&&result.status==='parameter',compatible=!!result&&['translated','parameter'].includes(result.status)&&all.every(s=>['translated','parameter'].includes(s.status)),document=compatible&&!parameterOnly?result!.document:null
  return {id:flow.id,name:flow.name,result:flow.result,steps:all,compatible,document,sql:document?preparationSQL(document):null,output:compatible?result!.output:null,...flow.metadata?{metadata:flow.metadata}:{}}
 })
}
export function preparationDigest(value:unknown){return sha256(canonicalJson(value))}
