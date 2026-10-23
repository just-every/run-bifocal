import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { readSources, sourceMatch } from '../../data/snapshots/store'
import { queryContext } from '../../query/context'
import { execute } from '../../query/execute'
import { fail, QueryError, type Answer } from '../../query/types'
import { scopedQuery, type Definition } from './protocol'
export type Owner=D1Sql & {email:string}
export type Model={id:string;owner_id:string;generation:number;production:string|null;staging:string|null;cache_epoch:number}
export type Branch={id:string;model_id:string;base_generation:number;revision_id:string;version:number;approval_json:string|null}
export async function readModel(env:Bindings,ownerId:string,id:string):Promise<Model>{
 const row=await env.DB.prepare('SELECT * FROM bf_semantic_models WHERE id=? AND owner_id=?').bind(id,ownerId).first<Model>()
 if(!row)fail('model_not_found',404);return row
}
export const modelGuard=(model:Model)=>sql('EXISTS(SELECT 1 FROM bf_semantic_models WHERE id=? AND owner_id=? AND generation=? AND production IS ? AND staging IS ? AND cache_epoch=?)',model.id,model.owner_id,model.generation,model.production,model.staging,model.cache_epoch)
export const branchGuard=(branch:Branch)=>sql('EXISTS(SELECT 1 FROM bf_semantic_branches WHERE id=? AND revision_id=? AND version=? AND base_generation=?)',branch.id,branch.revision_id,branch.version,branch.base_generation)
export async function readBranch(env:Bindings,model:Model,id:string):Promise<Branch>{
 const row=await env.DB.prepare('SELECT * FROM bf_semantic_branches WHERE id=? AND model_id=?').bind(id,model.id).first<Branch>()
 if(!row)fail('branch_not_found',404);return row
}
export async function readDefinition(env:Bindings,id:string):Promise<Definition>{
 const row=await env.DB.prepare('SELECT definition_json FROM bf_semantic_revisions WHERE id=?').bind(id).first<{definition_json:string}>()
 if(!row)fail('revision_not_found',404);return JSON.parse(row.definition_json)
}
export function revisionStatement(modelId:string,definition:Definition){const id=randomUUID();return {id,statement:sql('INSERT INTO bf_semantic_revisions(id,model_id,definition_json,created_at) VALUES(?,?,?,?)',id,modelId,canonicalJson(definition),new Date().toISOString())}}
type Inspection={state:'absent'}|{state:'failed';error:string}|{state:'compiled';answer:Answer}
export async function validateBranch(env:Bindings,model:Model,branch:Branch) {
 const candidate=await readDefinition(env,branch.revision_id),base=model.production ? await readDefinition(env,model.production) : {views:[],quality:[]}
 const guards:D1Sql[]=[modelGuard(model),...(branch.id==='rollback'?[]:[branchGuard(branch)])]
 const impacts:{id:string;kind:string;before:Inspection;after:Inspection;accessReviewRequired:boolean}[]=[]
 for(const viewId of new Set([...base.views.map(v=>v.id),...candidate.views.map(v=>v.id)])) {
  const before=base.views.find(v=>v.id===viewId),after=candidate.views.find(v=>v.id===viewId)
  const inspect=async(view:typeof before,revision:string)=>{
   if(!view)return {state:'absent' as const}
   try {
    const query=scopedQuery(view,revision),context=await queryContext(env,query,model.owner_id),sources=await readSources(env,query)
    guards.push(...context.guards??[],...sources.map(sourceMatch))
    const answer=execute(query,sources,context)
    return {state:'compiled' as const,answer}
   }catch(error){if(error instanceof QueryError)return {state:'failed' as const,error:error.code};throw error}
  }
  const old=await inspect(before,model.production??'unpublished'),next=await inspect(after,branch.revision_id)
  // Any removed/changed restriction requires explicit human resolution, even if
  // today's rows do not yet demonstrate the newly permitted scope.
  const accessChanged=!!before && (!after || before.rowRules.some(rule=>!after.rowRules.some(r=>canonicalJson(rule)===canonicalJson(r))) || before.query.dataset!==after.query.dataset || canonicalJson(before.query.joins)!==canonicalJson(after.query.joins))
  impacts.push({id:viewId,kind:after?.kind??before!.kind,before:old,after:next,accessReviewRequired:accessChanged})
 }
 const quality=candidate.quality.map(check=>{
  const after=impacts.find(impact=>impact.id===check.view)?.after
  return {...check,passed:after?.state==='compiled' && after.answer.totals[check.measure]?.state==='value' && after.answer.totals[check.measure]?.value===check.expected}
 })
 const compatible=branch.base_generation===model.generation && impacts.every(i=>i.after.state==='compiled') && quality.every(q=>q.passed)
 const dependencies= model.production ? (await env.DB.prepare(`
 SELECT 'query' AS kind,id,id AS snapshot_id FROM bf_query_snapshots WHERE owner_id=? AND json_extract(query_json,'$.context.modelVersion')=?
 UNION ALL SELECT 'saved-'||a.kind,a.id,a.snapshot_id FROM bf_query_artifacts a JOIN bf_query_snapshots q ON q.id=a.snapshot_id WHERE a.owner_id=? AND json_extract(q.query_json,'$.context.modelVersion')=?
 UNION ALL SELECT 'board-'||b.kind,b.id,c.snapshot_id FROM bf_analytics_boards b JOIN bf_analytics_cards c ON c.board_id=b.id JOIN bf_query_snapshots q ON q.id=c.snapshot_id WHERE b.owner_id=? AND json_extract(q.query_json,'$.context.modelVersion')=?
 ORDER BY kind,id,snapshot_id LIMIT 201`).bind(model.owner_id,model.production,model.owner_id,model.production,model.owner_id,model.production).all<{kind:string;id:string;snapshot_id:string}>()).results : []
 if(dependencies.length>200)fail('dependency_inventory_limit',413)
 if(model.production)guards.push(sql(`(SELECT count(*) FROM bf_query_snapshots WHERE owner_id=? AND json_extract(query_json,'$.context.modelVersion')=?)=?`,model.owner_id,model.production,dependencies.filter(d=>d.kind==='query').length),sql(`(SELECT count(*) FROM bf_query_artifacts a JOIN bf_query_snapshots q ON q.id=a.snapshot_id WHERE a.owner_id=? AND json_extract(q.query_json,'$.context.modelVersion')=?)=?`,model.owner_id,model.production,dependencies.filter(d=>d.kind.startsWith('saved-')).length),sql(`(SELECT count(*) FROM bf_analytics_boards b JOIN bf_analytics_cards c ON c.board_id=b.id JOIN bf_query_snapshots q ON q.id=c.snapshot_id WHERE b.owner_id=? AND json_extract(q.query_json,'$.context.modelVersion')=?)=?`,model.owner_id,model.production,dependencies.filter(d=>d.kind.startsWith('board-')).length))
 const review={modelId:model.id,branchId:branch.id,revision:branch.revision_id,generation:model.generation,branchVersion:branch.version,impacts,quality,compatible,dependencies:dependencies.map(d=>({...d,history:'pinned-original'})),accessReviewRequired:impacts.some(i=>i.accessReviewRequired),sideEffects:{productionSends:0,sourceWrites:0},inheritingClauses:['BIF-006','BIF-007','BIF-010','BIF-012','BIF-014','BIF-015','BIF-020','BIF-022','BIF-063','BIF-069']}
 return {review:{...review,digest:sha256(canonicalJson(review))},guards:[...new Map(guards.map(guard=>[canonicalJson(guard),guard])).values()]}
}
export async function promote(env:Bindings,owner:Owner,model:Model,branch:Branch,environment:'staging'|'production',digest:unknown){
 if(branch.base_generation!==model.generation)fail('stale_model_branch',409)
 const {review,guards}=await validateBranch(env,model,branch)
 const approval=branch.approval_json?JSON.parse(branch.approval_json):null
 if(!review.compatible || !approval || digest!==review.digest || approval.digest!==review.digest || approval.ownerId!==model.owner_id || review.accessReviewRequired && !approval.securityResolution)fail('exact_current_review_required',409)
 if(environment==='production' && model.staging!==branch.revision_id)fail('staging_first_required',409)
 const epoch=model.cache_epoch+1,now=new Date().toISOString()
 const changes=[...guards.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_semantic_branches WHERE id=? AND approval_json=?)',branch.id,branch.approval_json)),sql(`UPDATE bf_semantic_models SET ${environment}=?,cache_epoch=?,generation=generation+? WHERE id=?`,branch.revision_id,epoch,environment==='production'?1:0,model.id),sql('DELETE FROM bf_semantic_cache WHERE model_id=?',model.id),sql('INSERT INTO bf_semantic_history(id,model_id,environment,revision_id,action,actor_id,cache_epoch,recorded_at) VALUES(?,?,?,?,?,?,?,?)',randomUUID(),model.id,environment,branch.revision_id,'promote',model.owner_id,epoch,now)]
 await transact(env.DB,owner,changes)
 return {revision:branch.revision_id,environment,cacheEpoch:epoch,productionSends:0,sourceWrites:0}
}
