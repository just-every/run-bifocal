import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Snapshot } from '../data/snapshots/store'
import { metric, metricGuard, revision } from '../metrics/store.server'
import { modelGuard, readModel } from '../models/validation/store.server'
import { fail, type Context } from '../query/types'

/** Refreshing a historical query never changes its published authority. */
export async function refreshBindings(env:Bindings,ownerId:string,snapshot:Snapshot):Promise<D1Sql[]> {
 if(snapshot.context.securityScope.kind!=='installation-owner'||snapshot.context.securityScope.ownerId!==ownerId)fail('dashboard_owner_scope_required',403)
 const guards:D1Sql[]=[],version=snapshot.definition.context.modelVersion
 const native=await env.DB.prepare('SELECT model_id,definition_json FROM bf_semantic_revisions WHERE id=?').bind(version).first<{model_id:string;definition_json:string}>()
 const exploration=snapshot.context.exploration
 if(native||exploration) {
  const model=await readModel(env,ownerId,native?.model_id??exploration!.modelId)
  if(model.production!==version||exploration&&(exploration.modelId!==model.id||exploration.revision!==version))fail('published_model_changed',409)
  if(!native)fail('native_model_revision_unavailable',409)
  guards.push(modelGuard(model),sql('EXISTS(SELECT 1 FROM bf_semantic_revisions WHERE id=? AND model_id=? AND definition_json=?)',version,model.id,native.definition_json))
 } else if(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(version))fail('native_model_revision_unavailable',409)
 const reference=snapshot.context.metric
 if(reference) {
  const row=await metric(env,ownerId,reference.id)
  if(row.deprecated_at||row.published_revision!==reference.revision)fail('current_published_metric_required',409)
  const retained=await revision(env,row.id,reference.revision)
  if(!retained||!retained.approved_at||retained.digest!==reference.digest)fail('current_published_metric_required',409)
  guards.push(metricGuard(row),sql('EXISTS(SELECT 1 FROM bf_metric_revisions WHERE metric_id=? AND revision=? AND digest=? AND document_json=? AND approved_at IS NOT NULL)',row.id,retained.revision,retained.digest,retained.document_json))
 }
 return guards
}

/** Conventions stay attached to the original answer rather than being relabeled
 * after company, calendar, rate, currency or timezone changes. */
export function sameRefreshConventions(retained:Context,current:Context) {
 const conventions=(context:Context)=>({company:context.company,calendar:context.calendar,rateSource:context.rateSource,timezone:context.timezone,currency:context.currency})
 return canonicalJson(conventions(retained))===canonicalJson(conventions(current))
}
