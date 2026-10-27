import { dependencySchemas } from './schemas.server'
import type { Bindings } from '../../../auth.server'
import type { Query } from '../../query/types'
import type { Definition } from '../validation/protocol'
import { queryDependencies } from './dependencies'

/** Impact is enumerated from retained and published native records, including
 * each board position. It neither drops a column nor invents future doors. */
export async function sourceImpact(env:Bindings,dataset:string,column:string,ownerId:string) {
 const schemas=await dependencySchemas(env)
 const depends=(query:Query,columns=schemas)=>queryDependencies(query,columns).some(d=>d.dataset===dataset&&d.columns.includes(column))
 const candidates=(await env.DB.prepare('SELECT q.id,q.query_json,q.context_json FROM bf_query_snapshots q JOIN bf_query_sources s ON s.snapshot_id=q.id WHERE s.dataset_id=? AND q.owner_id=? ORDER BY q.id').bind(dataset,ownerId).all<{id:string;query_json:string;context_json:string}>()).results
 const snapshots=[]
 for(const candidate of candidates){const columns=await dependencySchemas(env,candidate.id);if(depends(JSON.parse(candidate.query_json),columns))snapshots.push({...candidate,columns})}
 const artifacts:Record<string,unknown>[]=[],cards:Record<string,unknown>[]=[],charts:Record<string,unknown>[]=[]
 for(const snapshot of snapshots) {
  artifacts.push(...(await env.DB.prepare('SELECT id,kind,title,snapshot_id FROM bf_query_artifacts WHERE snapshot_id=? AND owner_id=?').bind(snapshot.id,ownerId).all()).results)
  const boardCards=(await env.DB.prepare('SELECT b.id,b.kind,b.title,c.position,c.snapshot_id FROM bf_analytics_boards b JOIN bf_analytics_cards c ON c.board_id=b.id WHERE c.snapshot_id=? AND b.owner_id=? ORDER BY b.id,c.position').bind(snapshot.id,ownerId).all()).results
  cards.push(...boardCards);artifacts.push(...boardCards)
  charts.push(...(await env.DB.prepare('SELECT id,snapshot_id FROM bf_charts WHERE snapshot_id=? AND owner_id=?').bind(snapshot.id,ownerId).all()).results)
 }
 const metrics=(await env.DB.prepare('SELECT r.metric_id,r.revision,r.document_json,m.published_revision FROM bf_metric_revisions r JOIN bf_metrics m ON m.id=r.metric_id WHERE m.owner_id=? ORDER BY r.metric_id,r.revision').bind(ownerId).all<{metric_id:string;revision:number;document_json:string;published_revision:number|null}>()).results.filter(r=>depends(JSON.parse(r.document_json).query)).map(r=>({id:r.metric_id,revision:r.revision,published:r.published_revision===r.revision}))
 const models=[]
 const published=(await env.DB.prepare('SELECT m.id,m.production,r.definition_json FROM bf_semantic_models m JOIN bf_semantic_revisions r ON r.id=m.production WHERE m.owner_id=? ORDER BY m.id').bind(ownerId).all<{id:string;production:string;definition_json:string}>()).results
 for(const model of published) {
  const views=(JSON.parse(model.definition_json) as Definition).views.filter(view=>depends({...view.query,filters:[...view.query.filters,...view.rowRules]}))
  if(views.length)models.push({id:model.id,revision:model.production,views:views.map(view=>view.id)})
 }
 return {source:{dataset,column},queries:snapshots.map(s=>s.id),answers:snapshots.map(s=>({id:s.id,modelRevision:(JSON.parse(s.query_json) as Query).context.modelVersion,metric:JSON.parse(s.context_json).metric??null,columns:queryDependencies(JSON.parse(s.query_json),s.columns)})),artifacts:[...new Map(artifacts.map(a=>[a.id,{id:a.id,kind:a.kind,title:a.title}])).values()],cards,charts,metrics,models,operation:'preview only',unresolved:['complete transform lineage','scheduled artifacts','provider analytical jobs']}
}
