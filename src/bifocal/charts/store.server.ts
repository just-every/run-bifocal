import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { readQuery,sourceMatch } from '../data/snapshots/store'
import {metricAnnotations,type MetricAnnotation} from '../collaboration/annotations.server'
import { fail } from '../query/types'
import { chartDocument } from './protocol'

type Owner=Parameters<typeof readQuery>[1]
type Row={id:string;snapshot_id:string;title:string;visual_json:string;owner_id:string;created_at:string}
export async function readChart(env:Bindings,owner:Owner,ownerId:string,id:string) {
 const row=await env.DB.prepare('SELECT * FROM bf_charts WHERE id=? AND owner_id=?').bind(id,ownerId).first<Row>()
 if(!row)fail('chart_not_found',404)
 const {snapshot,guard,sources}=await readQuery(env,owner,ownerId,row.snapshot_id)
 const ref=snapshot.context.metric
 let annotations:MetricAnnotation[]=[]
 if(ref){
  annotations=(await metricAnnotations(env,ref)).filter(annotation=>snapshot.answer.rows.some(point=>point.dimensions[0]===annotation.point))
  await transact(env.DB,owner,sources.map(sourceMatch).map(assertion))
 }
 const document=chartDocument({version:1,title:row.title,definition:snapshot.definition,visual:JSON.parse(row.visual_json)})
 await transact(env.DB,owner,[assertion(guard),assertion(sql('EXISTS(SELECT 1 FROM bf_charts WHERE id=? AND snapshot_id=? AND title=? AND visual_json=? AND owner_id=? AND created_at=?)',id,row.snapshot_id,row.title,row.visual_json,ownerId,row.created_at))])
 return {id,...document,queryId:snapshot.queryId,snapshotId:snapshot.snapshotId,answer:snapshot.answer,context:snapshot.context,digest:snapshot.digest,createdAt:row.created_at,annotations}
}
