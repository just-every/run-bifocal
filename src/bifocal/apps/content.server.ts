import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { readSources, sourceMatch } from '../data/snapshots/store'
import type { DashboardDocument } from '../dashboards/authoring.protocol'
import { metric, revision, type MetricDocument } from '../metrics/store.server'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, type Answer, type Query } from '../query/types'
import { visibleColumns, type Audience, type AppPage, type Frozen } from './protocol'

type Row={query_json:string;digest:string}
const labelled=(rows:Row[])=>rows.map((row,position)=>({label:'card-'+(position+1),query:JSON.parse(row.query_json) as Query}))
/** Retained exact answers: a board's ordered cards or one artifact's answer. */
async function retained(env:Bindings,ownerId:string,kind:'dashboard'|'report',id:string):Promise<Frozen|null> {
 const board=await env.DB.prepare('SELECT 1 AS ok FROM bf_analytics_boards WHERE id=? AND owner_id=? AND kind=?').bind(id,ownerId,kind).first()
 const rows=board
  ?(await env.DB.prepare('SELECT s.query_json,s.digest FROM bf_analytics_cards c JOIN bf_query_snapshots s ON s.id=c.snapshot_id WHERE c.board_id=? AND s.owner_id=? ORDER BY c.position').bind(id,ownerId).all<Row>()).results
  :(await env.DB.prepare('SELECT s.query_json,s.digest FROM bf_query_artifacts a JOIN bf_query_snapshots s ON s.id=a.snapshot_id WHERE a.id=? AND a.owner_id=? AND a.kind=?').bind(id,ownerId,kind).all<Row>()).results
 if(!rows.length)return null
 return {source:{kind:board?'board':'artifact',id,revision:'retained',digest:sha256(canonicalJson(rows.map(r=>r.digest)))},queries:labelled(rows)}
}
/** Publication freezes the exact queries, so later author edits never reach readers. */
export async function freezePage(env:Bindings,ownerId:string,page:AppPage):Promise<Frozen> {
 if(page.kind==='dashboard') {
  const authored=await env.DB.prepare('SELECT r.revision,r.document_json,r.digest FROM bf_dashboard_definitions d JOIN bf_dashboard_definition_revisions r ON r.dashboard_id=d.id AND r.revision=d.published_revision WHERE d.id=? AND d.owner_id=?').bind(page.ref,ownerId).first<{revision:number;document_json:string;digest:string}>()
  if(authored)return {source:{kind:'authored-dashboard',id:page.ref,revision:String(authored.revision),digest:authored.digest},queries:(JSON.parse(authored.document_json) as DashboardDocument).cards.map(card=>({label:card.key,query:card.definition}))}
 }
 if(page.kind==='dashboard'||page.kind==='report') {
  const found=await retained(env,ownerId,page.kind,page.ref)
  if(!found)fail(page.kind+'_content_not_found',404)
  return found
 }
 if(page.kind==='question') {
  const row=await env.DB.prepare('SELECT query_json,digest FROM bf_query_snapshots WHERE id=? AND owner_id=?').bind(page.ref,ownerId).first<Row>()
  if(!row)fail('question_content_not_found',404)
  return {source:{kind:'retained-answer',id:page.ref,revision:'retained',digest:row.digest},queries:labelled([row])}
 }
 const goal=await env.DB.prepare('SELECT g.metric_id,v.document_json FROM bf_goals g JOIN bf_goal_versions v ON v.goal_id=g.id AND v.version=g.version WHERE g.id=? AND g.owner_id=?').bind(page.ref,ownerId).first<{metric_id:string;document_json:string}>()
 if(!goal)fail('scorecard_content_not_found',404)
 const row=await metric(env,ownerId,goal.metric_id)
 if(!row.published_revision||row.deprecated_at)fail('certified_metric_required',409)
 const rev=(await revision(env,row.id,row.published_revision))!,definition=JSON.parse(goal.document_json) as {title:string;from:string;to:string;dateColumn:string;target:string},doc=JSON.parse(rev.document_json) as MetricDocument
 const through=new Date(Date.parse(definition.to)-86400000).toISOString().slice(0,10),query=structuredClone(doc.query)
 query.context.metricVersion=`metric:${row.id}:${rev.revision}`
 query.filters.push({column:definition.dateColumn,op:'gte',value:definition.from},{column:definition.dateColumn,op:'lte',value:through})
 return {source:{kind:'scorecard',id:page.ref,revision:String(rev.revision),digest:rev.digest},queries:[{label:'actual',query}],target:{title:definition.title,amount:definition.target,from:definition.from,to:definition.to}}
}
const present=(label:string,query:Query,answer:Answer)=>({label,columns:[...query.groupBy.map((name):{name:string;kind:string;unit?:string}=>({name,kind:'dimension'})),...query.measures.map((m):{name:string;kind:string;unit?:string}=>({name:m.id,kind:'measure',unit:m.unit}))],
 rows:answer.rows.map(row=>({dimensions:row.dimensions,values:Object.fromEntries(query.measures.map(m=>[m.id,{state:row.values[m.id].state,value:row.values[m.id].value}]))})),
 totals:Object.fromEntries(query.measures.map(m=>[m.id,{state:answer.totals[m.id].state,value:answer.totals[m.id].value}])),filteredRows:answer.filteredRows,sources:answer.sourceWatermarks.map(w=>({dataset:w.dataset,updatedAt:w.updatedAt}))})
/** Row and column rules bound every frozen query; a violated rule refuses the page. */
export async function runPage(env:Bindings,ownerId:string,page:AppPage,audience:Audience):Promise<{cards:ReturnType<typeof present>[];guards:D1Sql[];target?:Frozen['target']}> {
 const frozen=page.frozen
 if(!frozen)fail('app_content_not_frozen',409)
 if(frozen.target&&audience.rows.length)fail('scorecard_row_scope_unsupported',409)
 const cards=[],guards:D1Sql[]=[]
 for(const {label,query} of frozen.queries) {
  if(audience.columns&&visibleColumns(query).some(column=>!audience.columns!.includes(column)))fail('audience_column_not_permitted',403)
  const scoped:Query={...query,filters:[...query.filters,...audience.rows]},context=await queryContext(env,scoped,ownerId),sources=await readSources(env,scoped)
  cards.push(present(label,scoped,execute(scoped,sources,context)))
  guards.push(...(context.guards??[]),...sources.map(sourceMatch))
 }
 return {cards,guards,target:frozen.target}
}
