import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import type {D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import {canonicalJson} from '../../modules/import-kit/src/provenance/identity.ts'
import {readQuery,readSources,sourceMatch} from '../data/snapshots/store'
import {queryContext} from '../query/context'
import {retainedQuality} from '../query/quality.server'
import {queryInput} from '../query/validate'
import {modelScope} from '../query/model-scope.server'
import {execute} from '../query/execute'
import {fail,QueryError,type Filter,type Query} from '../query/types'
import {dashboardDefinitionGuard,dashboardRevisionGuard,readDashboardDefinitionState,readDashboardDefinitionRevision} from './authoring.store.server'
import {defaultInteractions,readerSelection,type ReaderSelection} from './interactions.protocol'
import {refreshBindings,sameRefreshConventions} from './tv-bindings.server'
import {readManifest} from './tv.server'
import {dashboardScenario} from './interactions.calculations.server'

export type DashboardRestrictions={rows:Filter[];columns:string[]|null}
export async function publishedDashboard(env:Bindings,actor:Authority,ownerId:string,id:string,pinnedRevision?:number){
 const custodian={...actor,id:ownerId},state=await readDashboardDefinitionState(env,custodian,id)
 if(!state||!pinnedRevision&&!state.publishedRevision)fail('published_dashboard_unavailable',404)
 if(pinnedRevision!==undefined&&(!Number.isSafeInteger(pinnedRevision)||pinnedRevision<1))fail('dashboard_pinned_revision_required',400)
 const revision=await readDashboardDefinitionRevision(env,custodian,id,pinnedRevision??state.publishedRevision!)
 if(pinnedRevision!==undefined&&!revision.wasPublished)fail('dashboard_pinned_publication_required',409)
 const manifest=await readManifest(env,ownerId,revision.boardId)
 if(!manifest||manifest.refs.length!==revision.document.cards.length)fail('published_dashboard_custody_changed',409)
 return {state,revision,manifest,config:revision.document.interactions??defaultInteractions(revision.document),guards:[dashboardDefinitionGuard(custodian,id,state),dashboardRevisionGuard(custodian,id,revision),...manifest.guards]}
}
const usedColumns=(query:Query)=>[...query.groupBy,...query.filters.map(f=>f.column),...query.measures.flatMap(m=>[m.column,m.numerator,m.denominator,m.weight,m.stateColumn,m.currencyColumn,m.rateDateColumn].filter((v):v is string=>!!v)),...(query.fiscal?[query.fiscal.column]:[])]
/** Receiving-door bridge: the caller supplies current native authority AND its
 * current source and data restrictions, then commits every returned guard with its
 * audience and version guards before disclosing the result. This function grants none. */
export async function runPublishedDashboard(env:Bindings,actor:Authority,ownerId:string,id:string,value:unknown,restrictions:DashboardRestrictions={rows:[],columns:null},inherited?:{filters:Filter[];fiscal:ReaderSelection['fiscal']},pinnedRevision?:number){
 const published=await publishedDashboard(env,actor,ownerId,id,pinnedRevision),{revision,manifest,config}=published,selection=readerSelection(value,config)
 if(inherited){for(const filter of inherited.filters)if(!config.dimensions.includes(filter.column))fail('dashboard_inherited_dimension_unavailable',403);for(const parameter of Object.keys(inherited.fiscal))if(!config.fiscalParameters.some(p=>p.id===parameter))fail('dashboard_inherited_period_unavailable',403)}
 // Inherited context is a protected intersection, not a removable reader filter.
 const protectedRows=[...restrictions.rows,...inherited?.filters??[]],periods={...selection.fiscal,...inherited?.fiscal??{}},guards:D1Sql[]=[...published.guards],cards=[]
 for(const [index,card] of revision.document.cards.entries()){
  let quality:Awaited<ReturnType<typeof retainedQuality>>|undefined
  try{
   const retained=await readQuery(env,actor,ownerId,manifest.refs[index].snapshot_id),snapshot=retained.snapshot
   if(canonicalJson(snapshot.definition)!==canonicalJson(card.definition))fail('published_dashboard_custody_changed',409)
   if(actor.role==='owner'&&actor.id===ownerId)quality=await retainedQuality(env,actor,ownerId,snapshot)
   guards.push(retained.guard,...await refreshBindings(env,ownerId,snapshot))
   const model=await modelScope(env,ownerId,card.definition);guards.push(...model.guards)
   const field=config.fieldParameters.find(p=>p.card===card.key),choice=field?.choices.find(c=>c.id===selection.fields[field.id]),fiscal=config.fiscalParameters.find(p=>p.cards.includes(card.key))
   const protectedQuery=queryInput({...card.definition,groupBy:choice?.groupBy??card.definition.groupBy,measures:choice?card.definition.measures.filter(m=>choice.measures.includes(m.id)):card.definition.measures,filters:[...card.definition.filters,...model.rows,...protectedRows],...(fiscal?{fiscal:{...card.definition.fiscal!,...periods[fiscal.id]}}:{})}),definition=queryInput({...protectedQuery,filters:[...protectedQuery.filters,...selection.filters]})
   if(restrictions.columns&&usedColumns(definition).some(column=>!restrictions.columns!.includes(column)))fail('dashboard_column_not_permitted',403)
   const context=await queryContext(env,definition,ownerId),sources=await readSources(env,definition)
   guards.push(...context.guards??[],...sources.map(sourceMatch))
   if(!sameRefreshConventions(snapshot.context,context)||canonicalJson(snapshot.context.modelImport??null)!==canonicalJson(context.modelImport??null))fail('dashboard_conventions_changed',409)
   const answer=execute(definition,sources,context),observed=sources.map(s=>s.table.source.lineage?.observedAt??s.table.updatedAt),oldest=Math.min(...observed.map(Date.parse))
   if(!Number.isFinite(oldest)||observed.some(at=>Date.parse(at)>Date.now()))fail('source_observation_time_unavailable',409)
   const whatIf=config.whatIfParameters.find(p=>p.card===card.key),scenario=whatIf?await dashboardScenario(env,ownerId,whatIf,selection,protectedQuery,context,sources,selection.filters,restrictions.columns):null
   if(scenario)guards.push(...scenario.guards)
   const {guards:privateGuards,...publicContext}=context,stale=Date.now()-oldest>86400000
   cards.push({quality,key:card.key,snapshotId:snapshot.snapshotId,status:answer.filteredRows===0?'empty':stale?'stale':'fresh',answer,definition,context:publicContext,observedAt:new Date(oldest).toISOString(),...(scenario?{scenario:{answer:scenario.answer,binding:scenario.binding}}:{})})
  }catch(error){cards.push({quality,key:card.key,status:'failed',error:error instanceof QueryError?error.code:'dashboard_tile_unavailable'})}
 }
 return {published,guards,result:{id,title:revision.document.title,revision:revision.revision,boardId:revision.boardId,document:revision.document,config,selection,inherited:inherited??{filters:[],fiscal:{}},refreshedAt:new Date().toISOString(),cards}}
}
