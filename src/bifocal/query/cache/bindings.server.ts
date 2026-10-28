import type {Bindings} from '../../../auth.server'
import {sql} from '../../../modules/import-kit/src/door/store.ts'
import {readModel,modelGuard} from '../../models/validation/store.server'
import {metric,metricGuard,revision} from '../../metrics/store.server'
import {fail,type Query} from '../types'

/** Native references carry live versions in addition to their query labels.
 * Free-form owner labels remain exact inputs, without inventing a model. */
export async function executionBindings(env:Bindings,ownerId:string,query:Query) {
 const guards=[]
 const model=await env.DB.prepare('SELECT model_id,definition_json FROM bf_semantic_revisions WHERE id=?').bind(query.context.modelVersion).first<{model_id:string;definition_json:string}>()
 if(model)guards.push(modelGuard(await readModel(env,ownerId,model.model_id)),sql('EXISTS(SELECT 1 FROM bf_semantic_revisions WHERE id=? AND definition_json=?)',query.context.modelVersion,model.definition_json))
 const ref=/^metric:([a-z][a-z0-9-]{0,63}):(\d+)$/.exec(query.context.metricVersion)
 if(ref){
  const current=await metric(env,ownerId,ref[1]),stored=await revision(env,ref[1],Number(ref[2]))
  if(!stored||current.deprecated_at||current.published_revision!==stored.revision)fail('metric_binding_changed',409)
  guards.push(metricGuard(current),sql('EXISTS(SELECT 1 FROM bf_metric_revisions WHERE metric_id=? AND revision=? AND digest=? AND document_json=?)',ref[1],stored.revision,stored.digest,stored.document_json))
 }
 return guards
}
