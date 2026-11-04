import type { Bindings } from '../../../../auth.server'
import { assertion, transact } from '../../../../modules/import-kit/src/door/store.ts'
import { readSources, sourceMatch } from '../../../data/snapshots/store'
import { definitionInput, type Definition } from '../../../models/validation/protocol'
import { exactKeys } from '../../../models/validation/transport'
import { queryContext } from '../../../query/context'
import { execute } from '../../../query/execute'
import { fail, QueryError, type Answer, type Cell, type Filter } from '../../../query/types'
import { digest, object, text } from '../compile'
import { importGuard, type MigrationRow } from '../store.server'
import { evidenceInput, evidenceKinds } from './manifest'

type Parameter={id:string;column:string;type:string;op:Filter['op'];value:Cell}
export type NativeDocument={definition:Definition;sourceRevision:string;parameters:Parameter[];reference:unknown}
export function nativeDocument(value:unknown):NativeDocument {
 const v=object(value);exactKeys(v,['definition','sourceRevision','parameters','reference'])
 const definition=definitionInput(v.definition)
 if(definition.views.length!==1||definition.quality.length)fail('looker_single_view_required',400)
 const view=definition.views[0],q=view.query
 if(q.joins.length||q.fiscal||view.rowRules.length||!q.semantic||q.semantic.hierarchies.length||q.measures.some(m=>!['sum','count-distinct'].includes(m.op)))fail('looker_unsupported_definition',422)
 if(!Array.isArray(v.parameters)||v.parameters.length>12)fail('looker_explicit_parameters_required',400)
 const parameters=v.parameters.map(value=>{const p=object(value);exactKeys(p,['id','column','type','op','value']);if(!/^[a-z][a-z0-9-]{0,63}$/.test(text(p.id,64))||!['text','money','number','date','boolean'].includes(String(p.type))||!['eq','gte','lte'].includes(String(p.op))||p.op!=='eq'&&p.type!=='date'||!['string','boolean'].includes(typeof p.value)&&p.value!==null)fail('looker_parameter_required',400);return p as Parameter})
 if(new Set(parameters.map(p=>p.id)).size!==parameters.length)fail('looker_duplicate_parameter',400)
 return {definition,sourceRevision:text(v.sourceRevision,128),parameters,reference:v.reference??null}
}
export async function reviewReconstruction(env:Bindings,owner:{email:string;sql:string;params?:unknown[]},ownerId:string,current:MigrationRow){
 if(current.value.source!=='looker-studio')fail('looker_project_required',400)
 const issues:{item:string;code:string;location:string}[]=[],guards=[importGuard(current)],evidence=[]
 for(const entry of current.value.items){
  if(entry.conflict)issues.push({item:entry.source.id,code:'source_conflict',location:entry.source.id})
  if(evidenceKinds.includes(entry.source.kind as typeof evidenceKinds[number])){
   try{const item=evidenceInput(JSON.parse(entry.native));evidence.push(item);if(item.id!==entry.source.id||item.kind!==entry.source.kind)throw Error('identity');if(item.status!=='supplied'||['blend','calculation'].includes(item.kind)&&item.original.trim().toLowerCase()!=='none')issues.push({item:item.id,code:item.status==='inaccessible'?'inaccessible_evidence':'unsupported_evidence',location:item.sourceLocation})}catch{issues.push({item:entry.source.id,code:'invalid_evidence',location:entry.source.id})}
  }
 }
 for(const kind of evidenceKinds)if(!evidence.some(e=>e.kind===kind))issues.push({item:kind,code:'missing_evidence',location:kind})
 const drafts:{item:string;definition:Definition|null;answer:Answer|null;reconciliation:'supplied'|'independently-reconciled'|'mismatch'|'unavailable'}[]=[]
 for(const entry of current.value.items.filter(i=>i.source.kind==='dashboard')){
  const result:typeof drafts[number]={item:entry.source.id,definition:null,answer:null,reconciliation:'unavailable'};drafts.push(result)
  try{
   const document=nativeDocument(JSON.parse(entry.native)),view=document.definition.views[0],q=structuredClone(view.query),sources=await readSources(env,q),source=sources[0]
   guards.push(...sources.map(sourceMatch))
   if(source.revision!==document.sourceRevision)issues.push({item:entry.source.id,code:'source_evidence_changed',location:q.dataset})
   const refs=new Set([...q.groupBy,...q.semantic!.grain,...q.measures.map(m=>m.column!),...q.filters.map(f=>f.column),...document.parameters.map(p=>p.column)])
   for(const name of refs)if(!source.table.columns.some(c=>c.name===name))issues.push({item:entry.source.id,code:'missing_physical_field',location:name})
   for(const dimension of q.semantic!.dimensions)if(!source.table.columns.some(c=>c.name===dimension.column&&c.type===dimension.type))issues.push({item:entry.source.id,code:'field_type_mismatch',location:dimension.column})
   for(const f of [...q.filters,...document.parameters])if(!['eq','gte','lte'].includes(f.op)||f.op!=='eq'&&source.table.columns.find(c=>c.name===f.column)?.type!=='date')issues.push({item:entry.source.id,code:'unsupported_filter',location:f.column})
   for(const p of document.parameters){if(source.table.columns.find(c=>c.name===p.column)?.type!==p.type)issues.push({item:entry.source.id,code:'parameter_type_mismatch',location:p.id});q.filters.push({column:p.column,op:p.op,value:p.value})}
   const context=await queryContext(env,q,ownerId);guards.push(...context.guards??[])
   result.definition=document.definition
   if(!issues.length){
    result.answer=execute(q,sources,context)
    // The reference is independently supplied evidence, never derived here.
    // This proves only native values against that reference, not a live report.
    result.reconciliation=document.reference===null?'supplied':digest(document.reference)===digest({rows:result.answer.rows.map(r=>({dimensions:r.dimensions,values:Object.fromEntries(Object.entries(r.values).map(([k,v])=>[k,v.value]))})),totals:Object.fromEntries(Object.entries(result.answer.totals).map(([k,v])=>[k,v.value]))})?'independently-reconciled':'mismatch'
    if(result.reconciliation==='mismatch')issues.push({item:entry.source.id,code:'reference_mismatch',location:entry.source.id})
   }
  }catch(error){issues.push({item:entry.source.id,code:error instanceof QueryError?error.code:'invalid_native_document',location:entry.source.id})}
 }
 if(!drafts.length)issues.push({item:'project',code:'native_definition_missing',location:'project'})
 // No partial preview can disguise an unresolved dependency elsewhere.
 if(issues.length)for(const draft of drafts){draft.answer=null;draft.reconciliation='unavailable'}
 const review={revision:current.revision,label:'Owner reconstruction review',evidence,issues,drafts,compatible:issues.length===0,state:'inactive',grants:'none',dispatch:'unavailable',sourceParity:'unproved',cutover:false}
 await transact(env.DB,owner,guards.map(assertion))
 return {review:{...review,digest:digest(review)},guards}
}
