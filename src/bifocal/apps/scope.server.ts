import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Authority } from '../catalog/authority.server'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { metric, metricGuard, revision } from '../metrics/store.server'
import { modelGuard, readModel } from '../models/validation/store.server'
import { fail, type Query } from '../query/types'
import type { AppDocument } from './protocol'

/** Current published semantics are checked even for a retained query. */
export async function queryBindings(env:Bindings,ownerId:string,query:Query) {
 const guards:D1Sql[]=[],models:{id:string;revision:string}[]=[],metrics:{id:string;revision:number}[]=[]
 const native=await env.DB.prepare('SELECT model_id FROM bf_semantic_revisions WHERE id=?').bind(query.context.modelVersion).first<{model_id:string}>()
 if(native) {
  const model=await readModel(env,ownerId,native.model_id)
  if(model.production!==query.context.modelVersion)fail('published_model_changed',409)
  guards.push(modelGuard(model));models.push({id:model.id,revision:model.production!})
 }else if(/^[a-f0-9-]{36}$/.test(query.context.modelVersion))fail('native_model_revision_unavailable',409)
 const reference=/^metric:([^:]+):(\d+)$/.exec(query.context.metricVersion)
 if(reference) {
  const row=await metric(env,ownerId,reference[1]),rev=await revision(env,row.id,Number(reference[2]))
  if(row.deprecated_at||row.published_revision!==Number(reference[2])||!rev?.approved_at)fail('current_published_metric_required',409)
  guards.push(metricGuard(row));metrics.push({id:row.id,revision:rev.revision})
 }
 return {guards,models,metrics}
}
export async function reviewedMembers(env:Bindings,appId:string) {
 return (await env.DB.prepare(`SELECT m.audience,m.operator_id AS operatorId,m.operator_version AS operatorVersion,o.email
  FROM bf_app_members m JOIN oa_operators o ON o.id=m.operator_id AND o.status='active' AND o.version=m.operator_version
  WHERE m.app_id=? ORDER BY m.audience,m.operator_id`).bind(appId).all<{audience:string;operatorId:string;operatorVersion:number;email:string}>()).results
}
/** Activation is never portable. Source and semantic changes permanently remove it. */
export async function activateVersion(env:Bindings,actor:Authority,id:string,version:number,document:AppDocument) {
 const expiry=Date.parse(document.expiresAt)
 if(expiry<=Date.now()||expiry>Date.now()+7*86400000)fail('app_expiry_within_seven_days_required',409)
 const owner=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active' AND role='owner'").bind(actor.id).first<{version:number}>()
 if(!owner)fail('owner_required',403)
 const changes:D1Sql[]=[sql('DELETE FROM bf_app_activation WHERE app_id=?',id),sql('INSERT INTO bf_app_activation(app_id,version,owner_version,expires_at) VALUES(?,?,?,?)',id,version,owner.version,document.expiresAt)]
 const sources=new Map<string,{revision:string;digest:string}>(),models=new Map<string,string>(),metrics=new Map<string,number>(),guards:D1Sql[]=[]
 for(const page of document.pages)for(const item of page.frozen?.queries??[]) {
  const binding=await queryBindings(env,actor.id,item.query);guards.push(...binding.guards)
  for(const ref of binding.models)models.set(ref.id,ref.revision)
  for(const ref of binding.metrics)metrics.set(ref.id,ref.revision)
  for(const source of await readSources(env,item.query)){sources.set(source.id,{revision:source.revision,digest:sha256(source.value_json)});guards.push(sourceMatch(source))}
 }
 for(const [source,ref] of sources)changes.push(sql('INSERT INTO bf_app_version_sources(app_id,version,dataset_id,revision,digest) VALUES(?,?,?,?,?)',id,version,source,ref.revision,ref.digest))
 for(const [model,revision] of models)changes.push(sql('INSERT INTO bf_app_version_models(app_id,version,model_id,revision) VALUES(?,?,?,?)',id,version,model,revision))
 for(const [metric,revision] of metrics)changes.push(sql('INSERT INTO bf_app_version_metrics(app_id,version,metric_id,revision) VALUES(?,?,?,?)',id,version,metric,revision))
 return {changes,guards}
}

export function membersGuard(appId:string,members:Awaited<ReturnType<typeof reviewedMembers>>) {
 const base="FROM bf_app_members m JOIN oa_operators o ON o.id=m.operator_id AND o.status='active' AND o.version=m.operator_version WHERE m.app_id=?"
 return sql('(SELECT count(*) '+base+')=?'+members.map(()=>" AND EXISTS(SELECT 1 "+base+' AND m.audience=? AND m.operator_id=? AND m.operator_version=?)').join(''),appId,members.length,...members.flatMap(m=>[appId,m.audience,m.operatorId,m.operatorVersion]))
}
