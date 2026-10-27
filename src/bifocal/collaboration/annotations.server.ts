import type {Bindings} from '../../auth.server'
import {fail} from '../query/types'

export type MetricAnnotation={id:string;point:string;body:string;revision:number;createdAt:string}
export async function metricAnnotations(env:Bindings,ref:{id:string;revision:number;digest:string}){
 const rows=(await env.DB.prepare('SELECT id,point,body,revision,created_at AS createdAt FROM bf_collaboration_annotations WHERE metric_id=? AND revision=? AND digest=? ORDER BY point,id LIMIT 101').bind(ref.id,ref.revision,ref.digest).all<MetricAnnotation>()).results
 if(rows.length>100)fail('annotation_history_limit',413)
 return rows
}
