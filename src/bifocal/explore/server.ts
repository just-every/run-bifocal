import { runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, transact } from '../../modules/import-kit/src/door/store.ts'
import { currentAuthority } from '../catalog/authority.server'
import { accessResponse, audit, readGrant, type Grant } from './access.server'
import { readSources, saveQuery, readQuery, type Snapshot } from '../data/snapshots/store'
import { modelGuard, readModel, readDefinition } from '../models/validation/store.server'
import { scopedQuery } from '../models/validation/protocol'
import { discardBody, exactKeys, json, jsonBody, privateHeaders } from '../models/validation/transport'
import { queryInput } from '../query/validate'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, QueryError, type Cell } from '../query/types'
import { exportTable, type ExportColumn } from './table-export'
const pageSize=25

/** Published fields and current explicit grants are checked on every door. */
export async function explorationResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(!/^\/api\/operator\/explore(?:\/|$)/.test(path))return null
 const env=runtimeBindings(original)
 try {
  const actor=await currentAuthority(request,env);if(!actor)return json({error:'owner_required'},401)
  if(url.search)fail('query_parameters_not_supported',400)
  const accessResult=await accessResponse(request,env,actor,path);if(accessResult)return accessResult
  const isOwner=actor.role==='owner'
  if(path==='/api/operator/explore'&&request.method==='GET') {
   const grants:Grant[]=[],guards=[]
   if(!isOwner){
    const ids=(await env.DB.prepare("SELECT g.id FROM bf_explore_grants g JOIN bf_explore_activation a ON a.grant_id=g.id WHERE g.operator_id=? AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY g.id LIMIT 101").bind(actor.id).all<{id:string}>()).results
    if(ids.length>100)fail('grant_catalog_limit',413)
    for(const id of ids){try{const access=await readGrant(env,actor,id.id);grants.push(access.grant);guards.push(...access.guards)}catch(error){if(!(error instanceof QueryError))throw error}}
   }
   const models=isOwner?(await env.DB.prepare('SELECT id,owner_id FROM bf_semantic_models WHERE owner_id=? AND production IS NOT NULL ORDER BY id LIMIT 101').bind(actor.id).all<{id:string;owner_id:string}>()).results:[...new Map(grants.map(g=>[g.definition.modelId,{id:g.definition.modelId,owner_id:g.owner_id}])).values()]
   if(models.length>100)fail('model_catalog_limit',413)
   const views=[]
   for(const row of models){const model=await readModel(env,row.owner_id,row.id);if(!model.production)continue;const definition=await readDefinition(env,model.production);guards.push(modelGuard(model))
    for(const view of definition.views)if(view.query.semantic){
     const permissions=isOwner?[null]:grants.filter(g=>g.definition.modelId===model.id&&g.definition.viewId===view.id)
     for(const grant of permissions){
      const dimensions=view.query.semantic.dimensions.filter(d=>!grant||grant.definition.underlying||grant.definition.dimensions.includes(d.column))
      views.push({modelId:row.id,revision:model.production,viewId:view.id,dimensions,hierarchies:view.query.semantic.hierarchies.filter(h=>h.every(c=>dimensions.some(d=>d.column===c))),groupBy:view.query.groupBy.filter(c=>dimensions.some(d=>d.column===c)),measures:view.query.measures.map(m=>({id:m.id,unit:m.unit})),fiscal:view.query.fiscal??null,...(grant?{grantId:grant.id,permissions:{underlying:grant.definition.underlying,summaryExport:grant.definition.summaryExport,underlyingExport:grant.definition.underlyingExport}}:{})})
     }
    }
   }
   const questions=(await env.DB.prepare("SELECT id,created_at,json_extract(context_json,'$.exploration.viewId') AS view_id FROM bf_query_snapshots WHERE json_extract(context_json,'$.exploration') IS NOT NULL AND ((?=1 AND owner_id=?) OR (?=0 AND json_extract(context_json,'$.exploration.operatorId')=?)) ORDER BY created_at DESC,id LIMIT 51").bind(isOwner?1:0,actor.id,isOwner?1:0,actor.id).all<{id:string;created_at:string;view_id:string}>()).results
   await transact(env.DB,actor,guards.map(assertion))
   return json({views,questions:questions.slice(0,50).map(q=>({id:q.id,createdAt:q.created_at,viewId:q.view_id})),historyLimited:questions.length>50,pageSize,limits:{csv:30000,xlsx:150000,sourceRows:2000},authority:isOwner?'installation-owner':'delegated-view'})
  }
  if(path==='/api/operator/explore/run') {
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['modelId','revision','viewId','groupBy','filters','fiscal','compareAsOf','grantId'])
   const access=isOwner?null:await readGrant(env,actor,input.grantId),grant=access?.grant,ownerId=grant?.owner_id??actor.id
   if(grant&&(grant.definition.modelId!==input.modelId||grant.definition.viewId!==input.viewId||grant.definition.revision!==input.revision))fail('exploration_access_required',403)
   const model=await readModel(env,ownerId,String(input.modelId));if(!model.production||input.revision!==model.production)fail('published_model_changed',409)
   const definition=await readDefinition(env,model.production),view=definition.views.find(v=>v.id===input.viewId)
   if(!view?.query.semantic)fail('governed_view_required',404)
   const allowed=new Set(view.query.semantic.dimensions.filter(d=>!grant||grant.definition.underlying||grant.definition.dimensions.includes(d.column)).map(d=>d.column))
   const candidate=queryInput({...view.query,groupBy:input.groupBy,filters:input.filters,...(input.fiscal===undefined?{}:{fiscal:input.fiscal})})
   if(candidate.groupBy.some(c=>!allowed.has(c))||candidate.filters.some(f=>!allowed.has(f.column)))fail('dimension_not_permitted',403)
   if(input.fiscal!==undefined&&(!view.query.fiscal||candidate.fiscal?.column!==view.query.fiscal.column))fail('fiscal_dimension_not_permitted',403)
   const query=queryInput({...scopedQuery(view,model.production),groupBy:candidate.groupBy,filters:[...view.query.filters,...view.rowRules,...(grant?.definition.filters??[]),...candidate.filters],...(candidate.fiscal?{fiscal:candidate.fiscal}:{})})
   const context=await queryContext(env,query,ownerId),sources=await readSources(env,query)
   context.guards=[...context.guards??[],modelGuard(model),...(access?.guards??[])]
   if(grant)context.securityScope={kind:'delegated-view',ownerId,operatorId:actor.id,grantId:grant.id}
   context.exploration={...(grant?{grantId:grant.id,operatorId:actor.id}:{}),modelId:model.id,viewId:view.id,revision:model.production,parameters:input}
   if(input.compareAsOf!==undefined){
    if(!query.fiscal)fail('fiscal_comparison_required',400)
    const comparison=queryInput({...query,fiscal:{...query.fiscal,asOf:input.compareAsOf}}),answer=execute(comparison,sources,context)
    if(grant){answer.inputRows=answer.filteredRows;answer.joinDiagnostics=[]}
    context.exploration.comparison={definition:comparison,answer}
   }
   const snapshot=await saveQuery(env,actor,query,context,sources)
   if(grant)await transact(env.DB,actor,[...access!.guards.map(assertion),audit(actor,grant,'question-run')])
   return json(snapshot,201)
  }
  const match=/^\/api\/operator\/explore\/([a-f0-9-]{36})(?:\/(page|export))?$/.exec(path)
  if(!match)fail('not_found',404)
  if(request.method!==(match[2]?'POST':'GET'))fail('method_not_allowed',405)
  let access=null,ownerId=actor.id
  if(!isOwner){
   const row=await env.DB.prepare("SELECT owner_id,json_extract(context_json,'$.exploration.grantId') AS grant_id FROM bf_query_snapshots WHERE id=? AND json_extract(context_json,'$.exploration.operatorId')=?").bind(match[1],actor.id).first<{owner_id:string;grant_id:string}>()
   if(!row)fail('question_not_found',404)
   ownerId=row.owner_id;access=await readGrant(env,actor,row.grant_id)
  }
  const {snapshot,sources,guard}=await readQuery(env,actor,ownerId,match[1]),exploration=snapshot.context.exploration
  if(!exploration)fail('question_not_found',404)
  const model=await readModel(env,ownerId,exploration.modelId)
  if(model.production!==exploration.revision)fail('published_model_changed',409)
  const modelFence=modelGuard(model),grant=access?.grant
  const fences=[assertion(guard),assertion(modelFence),...(access?.guards??[]).map(assertion),...(grant?[audit(actor,grant,match[2]??'question-read')]:[])]
  if(!match[2]){await transact(env.DB,actor,fences);return json(snapshot)}
  const input=await jsonBody(request);exactKeys(input,match[2]==='export'?['scope','format']:['scope','offset'])
  if(!['summary','underlying'].includes(String(input.scope)))fail('explicit_export_scope_required',400)
  if(grant&&(input.scope==='underlying'&&!grant.definition.underlying||match[2]==='export'&&(input.scope==='summary'?!grant.definition.summaryExport:!grant.definition.underlyingExport)))fail('exploration_scope_not_permitted',403)
  const {columns,rows}=table(snapshot,sources,input.scope==='underlying')
  if(match[2]==='export') {
   if(input.format!=='csv'&&input.format!=='xlsx')fail('export_format_required',400)
   const cap=input.format==='csv'?30000:150000
   if(rows.length>cap)fail('full_export_unavailable',413)
   if(input.scope==='summary'&&snapshot.answer.rows.some(row=>Object.values(row.values).some(value=>!['value','null'].includes(value.state))))fail('incomplete_summary_export_refused',409)
   const output=exportTable(columns,rows,input.format)
   await transact(env.DB,actor,fences)
   return new Response(output.body,{headers:{...privateHeaders,'content-type':output.type,'content-disposition':`attachment; filename="bifocal-${input.scope}.${input.format}"`,'x-bifocal-row-count':String(rows.length),'x-bifocal-scope':String(input.scope)}})
  }
  if(!Number.isSafeInteger(input.offset)||Number(input.offset)<0||Number(input.offset)>rows.length)fail('invalid_page_offset',400)
  await transact(env.DB,actor,fences)
  const offset=Number(input.offset)
  return json({columns,rows:rows.slice(offset,offset+pageSize),offset,totalRows:rows.length,nextOffset:offset+pageSize<rows.length?offset+pageSize:null,scope:input.scope,snapshotId:snapshot.snapshotId,totals:snapshot.answer.totals,filteredRows:snapshot.answer.filteredRows})
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'exploration_conflict',reason:'Reload the published model and run the question again.'},409)}finally{await discardBody(request)}
}
function table(snapshot:Snapshot,sources:Parameters<typeof execute>[1],underlying:boolean):{columns:ExportColumn[];rows:Cell[][]} {
 const query=snapshot.definition,dimensions=query.semantic!.dimensions
 if(underlying){
  const columns=dimensions.map(d=>({name:d.column,type:d.type})),rows:Cell[][]=[]
  execute(query,sources,snapshot.context,(scoped,resolve)=>{for(const row of scoped)rows.push(columns.map(c=>row[resolve(c.name)]??null))})
  return {columns,rows}
 }
 return {columns:[...query.groupBy.map(name=>({name,type:dimensions.find(d=>d.column===name)!.type})),...query.measures.map(m=>({name:m.id,type:m.unit==='money'?'money':'number'}))],rows:snapshot.answer.rows.map(row=>[...row.dimensions,...query.measures.map(m=>row.values[m.id].state==='value'?row.values[m.id].value:null)])}
}
