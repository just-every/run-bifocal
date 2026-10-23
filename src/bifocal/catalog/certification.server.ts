import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { queryInput } from '../query/validate'
import { fail, type Query } from '../query/types'
import type { Authority } from './authority.server'
/** Bounded native metric certification is a human-owned typed query definition.
 * It makes no claim that the remaining BIF-007 clients or authoring are built. */
export async function validateCertification(env:Bindings,actor:Authority,value:{kind:string;verified:boolean;definition:Record<string,unknown>}){
 if(value.kind!=='metric'||!value.verified)return {guards:[],datasets:[] as string[]}
 if(Object.keys(value.definition).some(k=>k!=='query'))fail('typed_metric_query_required',400)
 const query=queryInput(value.definition.query),context=await queryContext(env,query,actor.id),sources=await readSources(env,query)
 execute(query,sources,context)
 return {guards:[...context.guards??[],...sources.map(sourceMatch)],datasets:sources.map(source=>source.id)}
}
const formula=(query:Query)=>({...query,context:{...query.context,metricVersion:'catalog-revision-bound'}})
export async function certifiedReportMetric(env:Bindings,actor:Authority,reference:unknown,query:Query){
 if(!reference||typeof reference!=='object'||Array.isArray(reference))fail('certified_metric_reference_required',400)
 const ref=reference as Record<string,unknown>
 if(Object.keys(ref).some(k=>!['id','version'].includes(k))||typeof ref.id!=='string'||!Number.isSafeInteger(ref.version))fail('certified_metric_reference_required',400)
 const row=await env.DB.prepare("SELECT definition_json FROM bf_catalog_items WHERE id=? AND owner_id=? AND version=? AND kind='metric' AND verified=1 AND archived=0").bind(ref.id,actor.id,ref.version).first<{definition_json:string}>()
 if(!row)fail('current_certified_metric_required',409)
 const definition=JSON.parse(row.definition_json),certified=queryInput(definition.query)
 if(query.context.metricVersion!==ref.id+':'+ref.version||canonicalJson(formula(query))!==canonicalJson(formula(certified)))fail('certified_metric_query_mismatch',409)
 return {reference:{id:ref.id,version:Number(ref.version)},guard:sql("EXISTS(SELECT 1 FROM bf_catalog_items WHERE id=? AND owner_id=? AND version=? AND kind='metric' AND verified=1 AND archived=0 AND definition_json=?)",ref.id,actor.id,ref.version,row.definition_json)}
}
