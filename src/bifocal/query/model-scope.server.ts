import type {Bindings} from '../../auth.server'
import {canonicalJson} from '../../modules/import-kit/src/provenance/identity.ts'
import {readDefinition,readModel,modelGuard} from '../models/validation/store.server'
import {fail,type Query,type Filter} from './types'

/** A copied authored query cannot remove its published model's restrictions.
 * Ambiguous views with different rules need an explicit author correction. */
export async function modelScope(env:Bindings,ownerId:string,query:Query) {
 const native=await env.DB.prepare('SELECT model_id FROM bf_semantic_revisions WHERE id=?').bind(query.context.modelVersion).first<{model_id:string}>()
 if(!native){if(/^[a-f0-9-]{36}$/.test(query.context.modelVersion))fail('native_model_revision_unavailable',409);return {rows:[] as Filter[],guards:[]}}
 const model=await readModel(env,ownerId,native.model_id)
 if(model.production!==query.context.modelVersion)fail('published_model_changed',409)
 const views=(await readDefinition(env,model.production!)).views.filter(view=>view.query.dataset===query.dataset&&canonicalJson(view.query.joins)===canonicalJson(query.joins)&&query.measures.every(measure=>view.query.measures.some(allowed=>canonicalJson(allowed)===canonicalJson(measure))))
 if(!views.length)fail('dashboard_model_view_unavailable',403)
 const rows=views.map(view=>[...view.query.filters,...view.rowRules])
 if(rows.some(rules=>canonicalJson(rules)!==canonicalJson(rows[0])))fail('dashboard_model_view_ambiguous',403)
 return {rows:rows[0],guards:[modelGuard(model)]}
}
