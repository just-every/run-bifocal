import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { prepareQuery, readSources, sourceMatch } from '../data/snapshots/store'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail } from '../query/types'
import { dashboardDocument, dashboardId } from './authoring.protocol'
import { dashboardDefinitionGuard, readDashboardDefinition, readDashboardDefinitionState, readDashboardDefinitionRevision } from './authoring.store.server'

export async function prepareDashboardDefinition(env:Bindings,actor:Authority,value:unknown,id:unknown,previous:unknown) {
 const document=dashboardDocument(value),key=id===undefined||id===null?null:dashboardId(id),state=key?await readDashboardDefinitionState(env,actor,key):null
 if(key&&!state)fail('dashboard_definition_not_found',404)
 const previousRevision=previous===undefined?null:previous
 if(previousRevision!==(state?.revision??null))fail('dashboard_definition_revision_changed',409)
 const before=state?(await readDashboardDefinitionRevision(env,actor,key!,state.revision)).document:null,evaluations=[]
 for(const card of document.cards){const context=await queryContext(env,card.definition,actor.id),sources=await readSources(env,card.definition),answer=execute(card.definition,sources,context);evaluations.push({card,context,sources,answer})}
 const guards=[...state?[dashboardDefinitionGuard(actor,key!,state)]:[],...evaluations.flatMap(value=>[...value.context.guards??[],...value.sources.map(sourceMatch)])]
 const fingerprints=evaluations.map(value=>({key:value.card.key,watermarks:value.answer.sourceWatermarks,context:{company:value.context.company,calendar:value.context.calendar,rateSource:value.context.rateSource,timezone:value.context.timezone,currency:value.context.currency},answerDigest:sha256(canonicalJson(value.answer))}))
 const digest=sha256(canonicalJson({ownerId:actor.id,id:key,previousRevision,document,fingerprints,generation:state?.generation??null,publishedRevision:state?.publishedRevision??null}))
 return {state,evaluations,guards,review:{document,id:key,previousRevision,before,after:document,digest,productionSends:0,sourceWrites:0}}
}
export async function applyDashboardDefinition(env:Bindings,actor:Authority,input:{document?:unknown;id?:unknown;previousRevision?:unknown;reviewedDigest?:unknown}) {
 const prepared=await prepareDashboardDefinition(env,actor,input.document,input.id,input.previousRevision),{state,evaluations,guards,review}=prepared
 if(input.reviewedDigest!==review.digest)fail('exact_dashboard_definition_review_required',409)
 const id=review.id??randomUUID(),n=(state?.revision??0)+1,boardId=randomUUID(),now=new Date().toISOString(),retained=evaluations.map(value=>prepareQuery(value.card.definition,value.context,value.sources))
 await transact(env.DB,actor,[...guards.map(assertion),...state?[]:[assertion(dashboardDefinitionGuard(actor,id,null))],...retained.flatMap(value=>value.changes),
  sql("INSERT INTO bf_analytics_boards(id,kind,owner_id,title,created_at) VALUES(?,'dashboard',?,?,?)",boardId,actor.id,review.document.title,now),...retained.map((value,position)=>sql('INSERT INTO bf_analytics_cards(board_id,position,snapshot_id) VALUES(?,?,?)',boardId,position,value.snapshot.snapshotId)),
  state?sql('UPDATE bf_dashboard_definitions SET head_revision=? WHERE id=? AND owner_id=?',n,id,actor.id):sql('INSERT INTO bf_dashboard_definitions(id,owner_id,head_revision) VALUES(?,?,?)',id,actor.id,n),
  sql('INSERT INTO bf_dashboard_definition_revisions(dashboard_id,revision,document_json,board_id,digest,created_at) VALUES(?,?,?,?,?,?)',id,n,canonicalJson(review.document),boardId,review.digest,now),
  sql("INSERT INTO bf_dashboard_definition_history(id,dashboard_id,revision,action,actor_id,digest,recorded_at) VALUES(?,?,?,'draft',?,?,?)",randomUUID(),id,n,actor.id,review.digest,now)])
 return (await readDashboardDefinition(env,actor,id))!
}
