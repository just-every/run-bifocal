import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { certifiedReportMetric } from '../catalog/certification.server'
import type { Authority } from '../catalog/authority.server'
import { readQuery, sourceMatch } from '../data/snapshots/store'
import { fail, type Source } from '../query/types'
import { reviewerAccess } from './grant-access.server'
import { fencePending } from './recipients.server'
export type Run={id:string;series_id:string;owner_id:string;revision:number;corrects:string|null;period:string;snapshot_id:string|null;state:string;request_json:string|null;artifact_json:string|null;artifact_digest:string|null;approval_json:string|null;retain_until:string|null;created_at:string;version:number}
export async function readRun(env:Bindings,actor:Authority,id:string):Promise<Run>{
 const access=reviewerAccess(actor,id)
 const run=actor.role==='owner'?await env.DB.prepare('SELECT * FROM bf_report_runs WHERE id=? AND owner_id=?').bind(id,actor.id).first<Run>():await env.DB.prepare('SELECT * FROM bf_report_runs WHERE id=? AND ('+access.sql+')').bind(id,...access.params??[]).first<Run>()
 if(!run)fail('report_not_found',404)
 if(run.artifact_json){
  const artifact=JSON.parse(run.artifact_json)
  if(!run.snapshot_id||sha256(run.artifact_json)!==run.artifact_digest||artifact.runId!==run.id||artifact.seriesId!==run.series_id||artifact.revision!==run.revision||artifact.corrects!==run.corrects||artifact.securityScope?.ownerId!==run.owner_id)fail('report_artifact_integrity_failed',409)
 }
 return run
}
export const runGuard=(run:Run)=>sql('EXISTS(SELECT 1 FROM bf_report_runs WHERE id=? AND version=? AND state=? AND snapshot_id IS ? AND artifact_digest IS ?)',run.id,run.version,run.state,run.snapshot_id,run.artifact_digest)
export const reportAudit=(actor:Authority,run:Run,action:string)=>sql('INSERT INTO bf_report_audit(id,run_id,actor_id,action,version,recorded_at) VALUES(?,?,?,?,?,?)',randomUUID(),run.id,actor.id,action,run.version+1,new Date().toISOString())
export async function freshness(env:Bindings,sources:Source[]){
 const cutoffs=[],guards=[]
 for(const source of sources){
  const current=await env.DB.prepare('SELECT revision,value_json FROM bf_file_tables WHERE id=?').bind(source.id).first<{revision:string;value_json:string}>()
  if(!current)fail('current_source_unavailable',409)
  guards.push(sourceMatch({...source,...current}))
  cutoffs.push({dataset:source.id,snapshotRevision:source.revision,currentRevision:current.revision,stale:source.revision!==current.revision})
 }
 return {cutoffs,guards,stale:cutoffs.some(c=>c.stale)}
}
export async function render(env:Bindings,actor:Authority,run:Run){
 if(actor.role!=='owner'||actor.id!==run.owner_id)fail('report_not_found',404)
 if(run.state!=='queued'||!run.snapshot_id||!run.request_json)fail('render_not_queued',409)
 const pending=await fencePending(env,actor,run)
 const requested=JSON.parse(run.request_json),{snapshot,sources,guard}=await readQuery(env,actor,actor.id,run.snapshot_id),current=await freshness(env,sources)
 const metric=await certifiedReportMetric(env,actor,requested.metricRef,snapshot.definition)
 if(current.stale&&!requested.acceptStale)fail('fresh_snapshot_required',409)
 const artifact={runId:run.id,seriesId:run.series_id,revision:run.revision,corrects:run.corrects,period:run.period,title:requested.title,narrative:requested.narrative,artifactCreatedAt:new Date().toISOString(),snapshotCreatedAt:snapshot.createdAt,queryId:snapshot.queryId,snapshotDigest:snapshot.digest,metricRef:metric.reference,definitionVersions:snapshot.context.definitionVersions,metricVersion:snapshot.definition.context.metricVersion,sourceCutoffs:snapshot.answer.sourceWatermarks,filters:snapshot.definition.filters,securityScope:snapshot.context.securityScope,context:snapshot.context,audience:[actor.id],freshness:current.stale?'stale':'current-at-render',freshnessMeaning:'Freshness was evaluated at rendering; this is a dated immutable snapshot.',staleLabel:current.stale?'Stale snapshot: source data changed since this exact answer.':null,observedSources:current.cutoffs,answer:snapshot.answer}
 const bytes=canonicalJson(artifact),digest=sha256(bytes)
 await transact(env.DB,actor,[assertion(runGuard(run)),assertion(pending),assertion(guard),assertion(metric.guard),...current.guards.map(assertion),sql("UPDATE bf_report_runs SET artifact_json=?,artifact_digest=?,state='rendered',version=version+1 WHERE id=?",bytes,digest,run.id),reportAudit(actor,run,'rendered')])
 return {...artifact,digest,version:run.version+1}
}
export const reportErasureCounts=(dataset:string)=>[
 {store:'bf_report_controlled_artifacts',query:sql('SELECT count(*) FROM bf_report_runs WHERE snapshot_id IN (SELECT snapshot_id FROM bf_query_sources WHERE dataset_id=?) AND (artifact_json IS NOT NULL OR request_json IS NOT NULL)',dataset)},
 {store:'bf_report_downloads',query:sql('SELECT count(*) FROM bf_report_downloads WHERE run_id IN (SELECT id FROM bf_report_runs WHERE snapshot_id IN (SELECT snapshot_id FROM bf_query_sources WHERE dataset_id=?))',dataset)},
 {store:'bf_report_reviewer_grants',query:sql('SELECT count(*) FROM bf_report_reviewer_grants WHERE run_id IN (SELECT id FROM bf_report_runs WHERE snapshot_id IN (SELECT snapshot_id FROM bf_query_sources WHERE dataset_id=?))',dataset)},
 {store:'bf_report_pending_recipients',query:sql('SELECT count(*) FROM bf_report_pending_recipients WHERE run_id IN (SELECT id FROM bf_report_runs WHERE snapshot_id IN (SELECT snapshot_id FROM bf_query_sources WHERE dataset_id=?))',dataset)}
]
