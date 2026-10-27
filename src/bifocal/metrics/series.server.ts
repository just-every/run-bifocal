import {randomUUID} from 'node:crypto'
import type {Bindings} from '../../auth.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {prepareQuery,sourceMatch} from '../data/snapshots/store'
import type {fileOwner} from '../imports/files/owner.server'
import {fail} from '../query/types'
import {metric,metricGuard,metricValue,revision} from './store.server'
import {chartDocument} from '../charts/protocol'
import {details,document,exact,hidden,result,text} from './transport'

/** A series varies only the date grouping of the exact certified measure. */
export async function metricSeries(request:Request,env:Bindings,owner:NonNullable<Awaited<ReturnType<typeof fileOwner>>>,ownerId:string,viewer:{displayName:string;role:string},id:string,action:string,input:Record<string,unknown>){
 if(request.headers.has('authorization'))fail('native_owner_required',403)
 exact(input,['title','dateColumn','revision','reviewedDigest'])
 const title=text(input.title,160),dateColumn=text(input.dateColumn,160),row=await metric(env,ownerId,id)
 if(!row.published_revision)fail('metric_not_certified',409)
 const rev=(await revision(env,id,row.published_revision))!
 if(Number(input.revision)!==rev.revision||!rev.approved_at)fail('certified_metric_changed',409)
 const evaluation=await metricValue(env,ownerId,row,rev)
 if(!evaluation.sources[0].table.columns.some(column=>column.name===dateColumn&&column.type==='date'))fail('metric_date_column_required',400)
 const chart=chartDocument({version:1,title,definition:{...evaluation.query,groupBy:[dateColumn]},visual:{kind:'bar',dimension:dateColumn,measure:evaluation.query.measures[0].id}}),{definition,visual}=chart
 const reference={id,revision:rev.revision,digest:rev.digest}
 const guards=[metricGuard(row),sql('EXISTS(SELECT 1 FROM bf_metric_revisions WHERE metric_id=? AND revision=? AND digest=? AND approved_at IS NOT NULL)',id,rev.revision,rev.digest),...evaluation.context.guards??[],...evaluation.sources.map(sourceMatch)]
 const digest=sha256(canonicalJson({ownerId,title,definition,reference,guards}))
 const prepared=prepareQuery(definition,{...evaluation.context,metric:reference,guards},evaluation.sources)
 if(action==='series-review'){
  await transact(env.DB,owner,guards.map(assertion))
  if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return result(request,{title,dateColumn,revision:rev.revision,digest,answer:prepared.snapshot.answer},'',200)
  return document('Review certified metric chart',viewer,`<p>This retained date series uses certified metric revision ${rev.revision}. Creating a chart grants no new access.</p>${details('Exact date values',prepared.snapshot.answer)}<form method="post" action="/api/operator/metrics/${id}/series-create">${hidden('title',title)}${hidden('dateColumn',dateColumn)}${hidden('revision',rev.revision)}${hidden('reviewedDigest',digest)}<button type="submit">Create reviewed chart</button></form>`)
 }
 if(input.reviewedDigest!==digest)fail('exact_current_metric_chart_review_required',409)
 const chartId=randomUUID(),createdAt=new Date().toISOString()
 await transact(env.DB,owner,[...prepared.changes,sql('INSERT INTO bf_charts(id,snapshot_id,title,visual_json,owner_id,created_at) VALUES(?,?,?,?,?,?)',chartId,prepared.snapshot.snapshotId,title,canonicalJson(visual),ownerId,createdAt)])
 return result(request,{id:chartId,title,visual,...prepared.snapshot},'/app/charts/'+chartId)
}
