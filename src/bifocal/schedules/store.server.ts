import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { ConventionsError } from '../company/protocol'
import { audit, guarded, readVersion, sql, versions, type Authority } from '../company/store'
import { ownerIdentity, readSources, sourceMatch } from '../data/snapshots/store'
import { scopedQuery } from '../models/validation/protocol'
import { branchGuard, modelGuard, readBranch, readDefinition, readModel } from '../models/validation/store.server'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { QueryError } from '../query/types'
import { recurringDocument } from './protocol'
import { resolveRecurrence } from './recurrence'

const assertion=(guard:D1Sql)=>sql(`INSERT INTO bf_conventions_assertions(ok) SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END`,...guard.params??[])
export async function recurringSchedule(env:Bindings,owner:Authority,input:Record<string,unknown>,apply:boolean) {
 try {
  const document=recurringDocument(input.document),id=document.id,current=(await versions(env,owner,'bf_schedules',id))[0]?.version??null
  if(input.previousVersion!==current)throw new ConventionsError('stale_schedule_version',409)
  const previous=current?await readVersion(env,owner,'bf_schedules',id,current):null
  const previousValue=previous?JSON.parse(previous.value_json):null
  const ownerId=await ownerIdentity(env,owner),target=document.definition.target,model=await readModel(env,ownerId,target.modelId)
  const branch=target.environment==='development'?await readBranch(env,model,target.branchId!):null
  if(branch&&branch.base_generation!==model.generation)throw new ConventionsError('stale_model_branch',409)
  const revision=branch?.revision_id??(target.environment==='production'?model.production:model.staging)
  if(!revision)throw new ConventionsError('schedule_environment_unpublished',409)
  const modelDefinition=await readDefinition(env,revision),view=modelDefinition.views.find(view=>view.id===target.viewId)
  if(!view)throw new ConventionsError('schedule_view_not_found',404)
  const query=scopedQuery(view,revision),context=await queryContext(env,query,ownerId),sources=await readSources(env,query),answer=execute(query,sources,context)
  const resolution=resolveRecurrence(document)
  const binding={...target,revision,generation:model.generation,...branch?{branchVersion:branch.version}:{},sourceWatermarks:answer.sourceWatermarks,conventions:{companyRevision:context.company.revision,calendar:query.context.calendar,rateSource:query.context.rateSource??null}}
  const preview={totals:answer.totals,filteredRows:answer.filteredRows,sourceWatermarks:answer.sourceWatermarks}
  const semanticDiff={before:previousValue?.document??null,after:document,binding:{before:previousValue?.binding??null,after:binding}}
  const guards=[sql('COALESCE((SELECT MAX(version) FROM bf_schedules WHERE id=?),0)=?',id,current??0),modelGuard(model),...branch?[branchGuard(branch)]:[],...sources.map(sourceMatch),...context.guards??[],...previous?[sql('EXISTS(SELECT 1 FROM bf_schedules WHERE id=? AND version=? AND value_json=?)',id,previous.version,previous.value_json)]:[]]
  const digest=sha256(canonicalJson({ownerId,document,previousVersion:current,resolution,binding,query,preview,semanticDiff,guards}))
  if(!apply) {
   await guarded(env,owner,guards.map(assertion))
   return {document,previousVersion:current,digest,resolution,binding,preview,semanticDiff,productionSends:0,sourceWrites:0,active:false,dispatcher:'unavailable'}
  }
  if(input.reviewedDigest!==digest)throw new ConventionsError('exact_schedule_review_required',409)
  const version=(current??0)+1,createdAt=new Date().toISOString(),definition={name:document.definition.name,document,resolution,binding:{...binding,digest},dispatcher:'unavailable'},encoded=canonicalJson(definition)
  await guarded(env,owner,[...guards.map(assertion),sql('INSERT INTO bf_schedules(id,version,value_json,created_at,created_by) VALUES(?,?,?,?,?)',id,version,encoded,createdAt,owner.email),audit(owner,'bf_schedules',id,String(version),encoded,createdAt)])
  return {id,version,definition,createdAt,createdBy:owner.email,active:false,productionSends:0,sourceWrites:0}
 }catch(error){if(error instanceof QueryError)throw new ConventionsError(error.code,error.status);throw error}
}
