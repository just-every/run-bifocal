import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {canonicalJson} from '../../modules/import-kit/src/provenance/identity.ts'
import type {D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import {queryContext} from '../query/context'
import {readSources,sourceMatch} from '../data/snapshots/store'
import {queryInput} from '../query/validate'
import {fail} from '../query/types'
import type {DashboardDocument} from './authoring.protocol'
import {defaultInteractions,readerSelection} from './interactions.protocol'
import {dashboardScenario} from './interactions.calculations.server'
import {publishedDashboard} from './interactions.run.server'

/** Review binds parameter libraries and action destinations as well as layout.
 * Invalid scenarios or context mappings cannot become a published definition. */
export async function prepareDashboardInteractions(env:Bindings,actor:Authority,document:DashboardDocument,id:string|null=null){
 const config=document.interactions??defaultInteractions(document),selection=readerSelection({},config),guards:D1Sql[]=[],fingerprints:unknown[]=[]
 if(id){
  const previous=(await env.DB.prepare('SELECT document_json FROM bf_dashboard_definition_revisions WHERE dashboard_id=? ORDER BY revision LIMIT 101').bind(id).all<{document_json:string}>()).results
  if(previous.length>100)fail('dashboard_definition_history_limit',413)
  const states=previous.flatMap(row=>(JSON.parse(row.document_json) as DashboardDocument).interactions?.states??[])
  for(const shared of config.states){const same=states.find(s=>s.name===shared.name&&s.revision===shared.revision),latest=Math.max(0,...states.filter(s=>s.name===shared.name).map(s=>s.revision));if(same&&canonicalJson(same.selection)!==canonicalJson(shared.selection)||shared.revision<latest)fail('dashboard_shared_state_revision_changed',409)}
 }
 for(const binding of config.whatIfParameters){
  const card=document.cards.find(c=>c.key===binding.card)!,field=config.fieldParameters.find(p=>p.card===card.key),choice=field?.choices.find(c=>c.id===selection.fields[field.id]),period=config.fiscalParameters.find(p=>p.cards.includes(card.key)),query=queryInput({...card.definition,groupBy:choice?.groupBy??card.definition.groupBy,...period?{fiscal:{...card.definition.fiscal!,...selection.fiscal[period.id]}}:{}}),context=await queryContext(env,query,actor.id),sources=await readSources(env,query)
  const scenario=await dashboardScenario(env,actor.id,binding,selection,query,context,sources,[],null)
  guards.push(...scenario.guards,...context.guards??[],...sources.map(sourceMatch));fingerprints.push({binding:scenario.binding,answer:scenario.answer})
 }
 for(const action of config.actions){const target=await publishedDashboard(env,actor,actor.id,action.target);if(action.bindings.some(b=>!target.config.dimensions.includes(b.target))||action.fiscalBindings.some(b=>!target.config.fiscalParameters.some(p=>p.id===b.target)))fail('dashboard_action_target_mapping_unavailable',409);guards.push(...target.guards);fingerprints.push({action:action.id,target:target.state.id,revision:target.revision.revision})}
 return {guards,fingerprints}
}
