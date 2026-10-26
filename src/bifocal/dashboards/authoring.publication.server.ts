import {prepareDashboardInteractions} from './interactions.prepare.server'
import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import { assertion, sql } from '../../modules/import-kit/src/door/store.ts'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail } from '../query/types'
import { readBoard } from './store.server'
import { dashboardDefinitionGuard, dashboardRevisionGuard, readDashboardDefinitionState, readDashboardDefinitionRevision, type DashboardDefinitionState, type DashboardDefinitionRevision } from './authoring.store.server'

export type DashboardPublicationAction='publish'|'rollback'
/** A trusted estate caller already has its own exact owner review. Its selected
 * revision may be historical while the guarded native draft head remains newer. */
export function dashboardPublicationChanges(actor:Authority,state:DashboardDefinitionState,revision:DashboardDefinitionRevision,action:DashboardPublicationAction,digest:string,options:{estate?:boolean}={}):D1Sql[] {
 if(action!=='publish'&&action!=='rollback')fail('dashboard_publication_action_required',400)
 if(action==='publish'&&!options.estate&&revision.revision!==state.revision)fail('current_dashboard_draft_required',409)
 if(action==='rollback'&&(!revision.wasPublished||revision.revision===state.publishedRevision))fail('previous_published_dashboard_required',409)
 if(!/^[a-f0-9]{64}$/.test(digest))fail('exact_dashboard_publication_review_required',409)
 return [assertion(dashboardDefinitionGuard(actor,state.id,state)),assertion(dashboardRevisionGuard(actor,state.id,revision)),...action==='rollback'?[assertion(sql("EXISTS(SELECT 1 FROM bf_dashboard_definition_history WHERE dashboard_id=? AND revision=? AND action IN ('publish','rollback'))",state.id,revision.revision))]:[],
  sql('UPDATE bf_dashboard_definitions SET published_revision=?,generation=generation+1 WHERE id=? AND owner_id=?',revision.revision,state.id,actor.id),
  sql('INSERT INTO bf_dashboard_definition_history(id,dashboard_id,revision,action,actor_id,digest,recorded_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),state.id,revision.revision,action,actor.id,digest,new Date().toISOString())]
}

export async function prepareDashboardPublication(env:Bindings,actor:Authority,id:string,n:number,previousGeneration:unknown,action:unknown) {
 if(action!=='publish'&&action!=='rollback')fail('dashboard_publication_action_required',400)
 const state=await readDashboardDefinitionState(env,actor,id)
 if(!state)fail('dashboard_definition_not_found',404)
 if(!Number.isSafeInteger(previousGeneration)||previousGeneration!==state.generation)fail('dashboard_publication_generation_changed',409)
 const revision=await readDashboardDefinitionRevision(env,actor,id,n)
 if(action==='publish'&&state.revision!==n)fail('current_dashboard_draft_required',409)
 if(action==='rollback'&&(!revision.wasPublished||state.publishedRevision===n))fail('previous_published_dashboard_required',409)
 const board=await readBoard(env,actor,actor.id,revision.boardId,'dashboard')
 if(!board||board.cards.length!==revision.document.cards.length||board.cards.some((card,i)=>canonicalJson(card.definition)!==canonicalJson(revision.document.cards[i].definition)))fail('dashboard_definition_custody_conflict',409)
 const guards=[dashboardDefinitionGuard(actor,id,state),dashboardRevisionGuard(actor,id,revision),...board.guards],fingerprints=[]
 for(const card of board.cards) {
  const context=await queryContext(env,card.definition,actor.id),sources=await readSources(env,card.definition),answer=execute(card.definition,sources,context)
  guards.push(...context.guards??[],...sources.map(sourceMatch))
  fingerprints.push({snapshotDigest:card.digest,watermarks:answer.sourceWatermarks,conventions:{company:context.company,calendar:context.calendar,rateSource:context.rateSource,timezone:context.timezone,currency:context.currency}})
 }
 const interactions=await prepareDashboardInteractions(env,actor,revision.document)
 guards.push(...interactions.guards)
 fingerprints.push(...interactions.fingerprints as typeof fingerprints)
 const before=state.publishedRevision?(await readDashboardDefinitionRevision(env,actor,id,state.publishedRevision)).document:null
 const content={id,revision:n,previousGeneration:state.generation,action:action as DashboardPublicationAction,document:revision.document,before,after:revision.document,boardId:revision.boardId,productionSends:0,sourceWrites:0}
 const digest=sha256(canonicalJson({ownerId:actor.id,...content,head:state.revision,publishedRevision:state.publishedRevision,fingerprints}))
 return {state,revision,guards,review:{...content,digest}}
}
