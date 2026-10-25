import type { Bindings } from '../../auth.server'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { readQuery, readSources, saveQuery, sourceMatch } from '../data/snapshots/store'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, QueryError } from '../query/types'
import { dashboardFilters, filteredDashboardQuery } from './filters'
import { refreshBindings, sameRefreshConventions } from './tv-bindings.server'
import { readManifest } from './tv.server'

type Owner=Parameters<typeof readQuery>[1]
function displayedInput(input:Record<string,unknown>) {
 exactKeys(input,['definitionHash','watermarks','maxAgeSeconds','filters'])
 if(typeof input.definitionHash!=='string'||!/^[a-f0-9]{64}$/.test(input.definitionHash))fail('displayed_definition_hash_required',400)
 if(!Number.isSafeInteger(input.maxAgeSeconds)||Number(input.maxAgeSeconds)<1||Number(input.maxAgeSeconds)>31536000)fail('dashboard_max_age_required',400)
 if(!Array.isArray(input.watermarks)||!input.watermarks.length||input.watermarks.length>16)fail('displayed_watermarks_required',400)
 for(const value of input.watermarks) {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('displayed_watermarks_required',400)
  const watermark=value as Record<string,unknown>;exactKeys(watermark,['dataset','revision','updatedAt','sha256'])
  if(Object.keys(watermark).length!==4||typeof watermark.dataset!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(watermark.dataset)||typeof watermark.revision!=='string'||!watermark.revision||watermark.revision.length>256||typeof watermark.updatedAt!=='string'||watermark.updatedAt.length>128||!Number.isFinite(Date.parse(watermark.updatedAt))||typeof watermark.sha256!=='string'||!/^[a-f0-9]{64}$/.test(watermark.sha256))fail('displayed_watermarks_required',400)
 }
}

/** Only an explicit export click freezes this currently displayed tile. Ordinary
 * refresh stays read-only, and a changed display is refused before any save. */
export async function dashboardTvExportResponse(request:Request,env:Bindings,owner:Owner,ownerId:string):Promise<Response|null> {
 const match=/^\/api\/operator\/dashboards\/([a-f0-9-]{36})\/tiles\/([a-f0-9-]{36})\/export-snapshot$/.exec(new URL(request.url).pathname)
 if(!match)return null
 try {
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);displayedInput(input)
  const manifest=await readManifest(env,ownerId,match[1])
  if(!manifest||!manifest.refs.some(ref=>ref.snapshot_id===match[2]))fail('dashboard_tile_not_found',404)
  const retained=await readQuery(env,owner,ownerId,match[2]),snapshot=retained.snapshot
  const definition=filteredDashboardQuery(snapshot.definition,dashboardFilters(input.filters))
  const bindings=await refreshBindings(env,ownerId,snapshot),context=await queryContext(env,definition,ownerId)
  if(!sameRefreshConventions(snapshot.context,context))fail('dashboard_conventions_changed',409)
  if(canonicalJson(snapshot.context.modelImport??null)!==canonicalJson(context.modelImport??null))fail('published_model_changed',409)
  const sources=await readSources(env,snapshot.definition),answer=execute(definition,sources,context)
  if(answer.definitionHash!==input.definitionHash||canonicalJson(answer.sourceWatermarks)!==canonicalJson(input.watermarks))fail('displayed_dashboard_tile_changed',409)
  if(sources.some(source=>{const at=Date.parse(source.table.source.lineage?.observedAt??source.table.updatedAt);return !Number.isFinite(at)||at>Date.now()}))fail('source_observation_time_unavailable',409)
  context.guards=[...context.guards??[],...manifest.guards,retained.guard,...bindings,...sources.map(sourceMatch)]
  if(snapshot.context.metric)context.metric=snapshot.context.metric
  if(snapshot.context.environmentEstate)context.environmentEstate=snapshot.context.environmentEstate
  if(snapshot.context.exploration) {
   context.exploration={...snapshot.context.exploration}
   const previous=context.exploration.comparison
   if(previous){const comparison=filteredDashboardQuery(previous.definition,dashboardFilters(input.filters));context.exploration.comparison={definition:comparison,answer:execute(comparison,sources,context)}}
  }
  return json(await saveQuery(env,owner,definition,context,sources),201)
 }catch(error) {
  if(error instanceof QueryError)return json({error:error.code,...error.status===404||['published_model_changed','model_not_found','metric_not_found','current_published_metric_required','dashboard_conventions_changed','dashboard_owner_scope_required','native_model_revision_unavailable','dataset_not_found','snapshot_not_found','snapshot_integrity_failed'].includes(error.code)?{withdraw:true}:{}},error.status)
  return json({error:'dashboard_export_snapshot_conflict',withdraw:true},409)
 }finally{await discardBody(request)}
}
