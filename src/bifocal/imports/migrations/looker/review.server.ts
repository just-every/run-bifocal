import type { Bindings } from '../../../../auth.server'
import type { Authority } from '../../../catalog/authority.server'
import { assertion, transact } from '../../../../modules/import-kit/src/door/store.ts'
import { readModel, readDefinition, modelGuard } from '../../../models/validation/store.server'
import { scopedQuery } from '../../../models/validation/protocol'
import { readSources, sourceMatch } from '../../../data/snapshots/store'
import { previewInactiveDashboard } from '../../../dashboards/authoring.server'
import { dashboardDocument, type DashboardDocument } from '../../../dashboards/authoring.protocol'
import { digest, object } from '../compile'
import { importGuard, type MigrationRow } from '../store.server'
import { QueryError, type Query, type Answer, type Cell } from '../../../query/types'
import { dashboardIssues, lookerItems, stableId, type LookerDashboard, type LookerIssue } from './reader'

type Draft={item:string;sourceId:string;elements:{id:string;title:string;key:string;fields:unknown;filters:unknown;expression:unknown;dependencies:string[]}[];definition:DashboardDocument|null;answers:{key:string;answer:Answer}[]}
export async function reviewLooker(env:Bindings,owner:Omit<Authority,'id'|'role'>,ownerId:string,current:MigrationRow){
 const actor:Authority={...owner,id:ownerId,role:'owner'},guards=[importGuard(current)],issues:(LookerIssue&{item:string})[]=[],drafts:Draft[]=[]
 // Re-read the original files, rather than trusting a caller-supplied inventory
 // or mutable native evidence to authenticate its source definitions.
 try{
  const manifestEntry=current.value.items.find(i=>i.source.id==='looker-originals'&&i.source.kind==='schema')
  if(!manifestEntry)throw Error('originals')
  const manifest=JSON.parse(manifestEntry.source.original)
  const expected=lookerItems({version:1,projectId:current.id,source:'looker',cutoff:current.value.cutoff,rollbackPlan:current.value.rollbackPlan,files:manifest.files.map((f:{path:string;content:string})=>({path:f.path,content:f.content})),bindings:manifest.bindings})
  if(digest(manifest.files)!==digest(JSON.parse(expected[0].original).files))throw Error('file digests')
  for(const item of current.value.items){
   const original=expected.find(e=>e.id===item.source.id)
   if(!original||item.source.kind==='dashboard'&&original.original!==item.source.original)issues.push({item:item.source.id,location:item.source.id,code:'original_dashboard_mismatch',expression:'null',resolution:'Reimport the original dashboard files with their exact mappings; an inventory description cannot replace them.'})
   if(item.conflict)issues.push({item:item.source.id,location:item.source.id,code:'source_conflict',expression:'null',resolution:'Resolve every retained source conflict before preview.'})
   if(item.source.kind==='schema'&&item.native!==item.source.original)issues.push({item:item.source.id,location:item.source.id,code:'original_evidence_changed',expression:'null',resolution:'Use a reviewed original-file delta to change source evidence.'})
  }
  if(expected.some(e=>!current.value.items.some(i=>i.source.id===e.id)))throw Error('inventory')
 }catch{issues.push({item:'looker-originals',location:'project',code:'verified_original_files_required',expression:'null',resolution:'Supply complete original dashboard files and explicit model mappings through the original LookML intake.'})}
 for(const entry of current.value.items.filter(i=>i.source.kind==='dashboard')){
  const local:LookerIssue[]=[],add=(location:string,code:string,expression:unknown,resolution='Resolve this dependency and review again.')=>local.push({location,code,expression:JSON.stringify(expression??null),resolution})
  const draft:Draft={item:entry.source.id,sourceId:'',elements:[],definition:null,answers:[]};drafts.push(draft)
  try{
   const original=JSON.parse(entry.source.original) as LookerDashboard,doc=JSON.parse(entry.native) as LookerDashboard
   // Native edits may change the native title and layout, never erase source
   // obligations or silently replace model, field and security mappings.
   if(digest({...doc,document:null})!==digest(original))add(entry.source.id,'source_definition_changed',null,'Use a reviewed source delta to change originals or mappings.')
   local.push(...dashboardIssues(doc));draft.sourceId=String(doc.source.dashboard)
   const cards:DashboardDocument['cards']=[],desktop:DashboardDocument['layout']['desktop']=[],phone:DashboardDocument['layout']['phone']=[]
   const limits=new Map<string,number>()
   if(Array.isArray(doc.source.elements))for(const [index,value] of doc.source.elements.entries()){
    const e=object(value),key=stableId('element',String(e.name)),at=doc.file+':elements.'+index
    draft.elements.push({id:String(e.name),title:String(e.title??e.name),key,fields:e.fields,filters:e.filters??{},expression:e,dependencies:[String(e.model)+'.'+String(e.explore),...Array.isArray(e.fields)?e.fields.map(String):[]]})
    try{
     const binding=doc.bindings[String(e.model)+'.'+String(e.explore)];if(!binding)continue
     const model=await readModel(env,ownerId,binding.modelId);guards.push(modelGuard(model))
     if(model.production!==binding.revision){add(at,'model_revision_changed',binding.revision);continue}
     const definition=await readDefinition(env,binding.revision),view=definition.views.find(v=>v.id===binding.viewId)
     if(!view){add(at,'mapped_view_missing',binding.viewId);continue}
     const query:Query=structuredClone(scopedQuery(view,binding.revision)),sources=await readSources(env,query);guards.push(...sources.map(sourceMatch))
     if(query.dataset!==binding.dataset||sources[0].revision!==binding.sourceRevision)add(at,'source_evidence_changed',binding.dataset)
     if(query.joins.length||query.fiscal||!query.semantic||query.semantic.hierarchies.length)add(at,'unsupported_model_semantics',binding.viewId)
     const fields=Array.isArray(e.fields)?e.fields.map(String):[],groupBy:string[]=[],measures:Query['measures']=[]
     for(const field of fields){
      const mapped=binding.fields[field],column=sources[0].table.columns.find(c=>c.name===mapped),measure=query.measures.find(m=>m.id===mapped)
      if(measure){if(!['sum','count-distinct'].includes(measure.op)||!measure.column)add(at+'.'+field,'unsupported_measure',measure);else measures.push(measure)}
      else if(column&&query.semantic?.dimensions.some(d=>d.column===column.name))groupBy.push(column.name)
      else add(at+'.'+field,'unresolved_field',field)
     }
     if(!measures.length||new Set([...groupBy,...measures.map(m=>m.id)]).size!==fields.length)add(at+'.fields','complete_field_mapping_required',fields)
     // Native tables retain their deterministic physical text order. Other sort
     // and null-order semantics are refused, never approximated.
     const sourceDimensions=fields.filter(f=>groupBy.includes(binding.fields[f]))
     if(digest(e.sorts??null)!==digest(sourceDimensions.map(f=>f+' asc')))add(at+'.sorts','unsupported_sort',e.sorts,'Supply explicit ascending order for every physical grouping field; scalar tables use an empty sort list.')
     query.groupBy=groupBy;query.measures=measures;delete query.orderBy
     if(groupBy.length)query.orderBy=groupBy.map(column=>({column,direction:'asc',nulls:'last'}))
     for(const [field,expression] of Object.entries(e.filters&&typeof e.filters==='object'&&!Array.isArray(e.filters)?e.filters:{})){
      const mapped=binding.fields[field],column=sources[0].table.columns.find(c=>c.name===mapped&&query.semantic?.dimensions.some(d=>d.column===c.name))
      let literal:Cell|undefined
      if(column?.type==='text'&&typeof expression==='string'&&/^"[^"\\]*"$/.test(expression))literal=expression.slice(1,-1)
      if(column&&['number','money'].includes(column.type)&&typeof expression==='string'&&/^-?\d+(?:\.\d+)?$/.test(expression))literal=expression
      if(column?.type==='date'&&typeof expression==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(expression))literal=expression
      if(column?.type==='boolean'&&['yes','no'].includes(String(expression)))literal=expression==='yes'
      if(literal===undefined)add(at+'.filters.'+field,'unsupported_filter',expression,'Map a physical field and use an explicit literal equality; dynamic, relative-date, wildcard and expression filters require implementation.')
      else query.filters.push({column:mapped,op:'eq',value:literal})
     }
     cards.push({key,definition:query});desktop.push({key,x:Number(e.col)/2,y:Number(e.row),w:Number(e.width)/2,h:Number(e.height)});phone.push({key,x:0,y:index*Number(e.height),w:1,h:Number(e.height)});limits.set(key,Number(e.limit))
    }catch(error){add(at,error instanceof QueryError?error.code:'invalid_element_mapping',null)}
   }
   // Stack phone cards in source order, independent of desktop geometry.
   let y=0;for(const p of phone){p.y=y;y+=p.h}
   if(!local.length){
    const compiled=dashboardDocument({version:2,title:doc.source.title,cards,layout:{desktop,phone}})
    const edited=doc.document===null?compiled:dashboardDocument(doc.document)
    if(digest(edited.cards)!==digest(compiled.cards)||edited.interactions!==undefined)add(entry.source.id,'native_query_changed',null,'Only native title and placements are editable in this bounded draft; query changes need a reviewed source mapping.')
    if(!local.length){
     const preview=await previewInactiveDashboard(env,actor,edited);guards.push(...preview.guards);draft.definition=edited
     for(const value of preview.answers){if(value.answer.rows.length>limits.get(value.key)!)add(value.key,'source_limit_would_truncate',limits.get(value.key));if(value.answer.rows.some(r=>r.dimensions.some(d=>d===null||typeof d==='string'&&/[^\x20-\x7e]/.test(d))))add(value.key,'unresolved_collation_or_null_order',null)}
     if(!local.length)draft.answers=preview.answers
    }
   }
  }catch(error){add(entry.source.id,error instanceof QueryError?error.code:'invalid_dashboard_draft',null)}
  if(local.length){draft.answers=[];draft.definition=null}
  issues.push(...local.map(issue=>({...issue,item:entry.source.id})))
 }
 if(!drafts.length)issues.push({item:'project',location:'project',code:'dashboard_required',expression:'null',resolution:'Supply original dashboard definitions.'})
 if(issues.length)for(const draft of drafts){draft.definition=null;draft.answers=[]}
 const review={revision:current.revision,label:'Original LookML dashboard review',drafts,issues,compatible:issues.length===0,state:'inactive',grants:'none',dispatch:'unavailable',sourceParity:'unproved',cutover:false}
 await transact(env.DB,owner,guards.map(assertion))
 return {review:{...review,digest:digest(review)},guards}
}
