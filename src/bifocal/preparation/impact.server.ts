import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { metricGuard, type MetricRow, type MetricDocument } from '../metrics/store.server'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, QueryError, type Context, type Source, type Query } from '../query/types'
import type { executePreparation, Preparation } from './execute'

/** Compare existing definitions against a staged source without promoting it.
 * Certified definitions and retained answers remain immutable. */
export async function preparationImpact(env:Bindings,ownerId:string,document:Preparation,sources:Source[],result:ReturnType<typeof executePreparation>) {
 const guards=sources.map(sourceMatch),base=sources.find(s=>s.id===document.dataset)!
 const substitute=(all:Source[])=>all.map(source=>source.id===base.id&&result.output?{...source,table:{...source.table,columns:result.output.columns,rows:result.output.rows}}:source)
 const evaluate=(query:Query,context:Context,all:Source[])=>{
  const before=execute(query,all,context)
  if(!result.compatible)return {before:before.totals,after:null,error:result.error,changed:false,publishedChanged:false}
  try{
   const after=execute(query,substitute(all),context)
   return {before:before.totals,after:after.totals,error:null,changed:canonicalJson(before)!==canonicalJson(after),publishedChanged:false}
  }catch(error){if(!(error instanceof QueryError))throw error;return {before:before.totals,after:null,error:{code:error.code},changed:false,publishedChanged:false}}
 }
 const metrics=(await env.DB.prepare('SELECT m.*,r.document_json,r.digest FROM bf_metrics m JOIN bf_metric_revisions r ON r.metric_id=m.id AND r.revision=m.published_revision WHERE m.owner_id=? AND m.deprecated_at IS NULL AND r.dataset_id=? ORDER BY m.id LIMIT 101').bind(ownerId,base.id).all<MetricRow&{document_json:string;digest:string}>()).results
 if(metrics.length>100)fail('preparation_metric_impact_limit',413)
 const metricImpacts=[]
 for(const metric of metrics){
  const definition=JSON.parse(metric.document_json) as MetricDocument,context=await queryContext(env,definition.query,ownerId),all=await readSources(env,definition.query)
  guards.push(metricGuard(metric),...context.guards??[],...all.map(sourceMatch),sql('EXISTS(SELECT 1 FROM bf_metric_revisions WHERE metric_id=? AND revision=? AND digest=? AND approved_at IS NOT NULL)',metric.id,metric.published_revision,metric.digest))
  metricImpacts.push({id:metric.id,revision:metric.published_revision,name:definition.name,...evaluate(definition.query,context,all)})
 }
 const charts=(await env.DB.prepare('SELECT c.id,c.title,q.id AS snapshot_id,q.digest,q.query_json,q.context_json FROM bf_charts c JOIN bf_query_snapshots q ON q.id=c.snapshot_id JOIN bf_query_sources s ON s.snapshot_id=q.id WHERE c.owner_id=? AND s.dataset_id=? ORDER BY c.id LIMIT 101').bind(ownerId,base.id).all<{id:string;title:string;snapshot_id:string;digest:string;query_json:string;context_json:string}>()).results
 if(charts.length>100)fail('preparation_chart_impact_limit',413)
 const chartImpacts=[]
 for(const chart of charts){
  const rows=(await env.DB.prepare('SELECT dataset_id,revision,value_json FROM bf_query_sources WHERE snapshot_id=? ORDER BY dataset_id').bind(chart.snapshot_id).all<{dataset_id:string;revision:string;value_json:string}>()).results
  const all=rows.map(s=>({id:s.dataset_id,revision:s.revision,value_json:s.value_json,table:JSON.parse(s.value_json)})) as Source[]
  guards.push(sql('EXISTS(SELECT 1 FROM bf_charts c JOIN bf_query_snapshots q ON q.id=c.snapshot_id WHERE c.id=? AND c.owner_id=? AND q.id=? AND q.digest=?)',chart.id,ownerId,chart.snapshot_id,chart.digest))
  chartImpacts.push({id:chart.id,title:chart.title,...evaluate(JSON.parse(chart.query_json),JSON.parse(chart.context_json),all)})
 }
 return {impact:{metrics:metricImpacts,charts:chartImpacts,publishedChanged:false},guards}
}
