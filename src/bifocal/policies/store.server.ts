import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { modelGuard, readDefinition, readModel } from '../models/validation/store.server'
import { fail } from '../query/types'
import { policyInput, validatePolicyScope, type PolicyDocument } from './protocol'

export type PolicyVersion={revision:number;document_json:string;digest:string;created_at:string}
export async function readPolicy(env:Bindings,actor:Authority,id:string):Promise<PolicyVersion|null> {
 return env.DB.prepare(`SELECT r.revision,r.document_json,r.digest,r.created_at FROM bf_policy_definitions p
  JOIN bf_policy_definition_revisions r ON r.owner_id=p.owner_id AND r.policy_id=p.id AND r.revision=p.revision
  WHERE p.owner_id=? AND p.id=?`).bind(actor.id,id).first<PolicyVersion>()
}
export const policyGuard=(actor:Authority,id:string,revision:number|null)=>revision===null
 ?sql('NOT EXISTS(SELECT 1 FROM bf_policy_definitions WHERE owner_id=? AND id=?)',actor.id,id)
 :sql('EXISTS(SELECT 1 FROM bf_policy_definitions WHERE owner_id=? AND id=? AND revision=?)',actor.id,id,revision)
export const policyAudit=(actor:Authority,id:string,revision:number|null,digest:string,action:'read'|'review'|'apply')=>sql('INSERT INTO bf_policy_definition_audit(id,owner_id,actor_id,policy_id,revision,digest,action,recorded_at) VALUES(?,?,?,?,?,?,?,?)',randomUUID(),actor.id,actor.id,id,revision,digest,action,new Date().toISOString())

/** Hash exact live bindings, never return them as portable authorization. */
export async function reviewPolicy(env:Bindings,actor:Authority,value:unknown,previous:number|null) {
 let document=policyInput(value)
 const current=await readPolicy(env,actor,document.id)
 if((current?.revision??null)!==previous)fail('policy_revision_changed',409)
 const model=await readModel(env,actor.id,document.modelId)
 if(!model.production)fail('published_model_required',409)
 const view=(await readDefinition(env,model.production)).views.find(v=>v.id===document.viewId)
 if(!view?.query.semantic)fail('governed_view_required',404)
 document=validatePolicyScope(document,view.query)
 const sources=await readSources(env,view.query)
 const guards=[policyGuard(actor,document.id,previous),modelGuard(model),...sources.map(sourceMatch)]
 const review={document,previousRevision:previous,before:current?JSON.parse(current.document_json) as PolicyDocument:null,after:document,active:false as const,productionSends:0,sourceWrites:0}
 // Model generation and source revisions are review inputs, not document fields.
 const digest=sha256(canonicalJson({review,ownerId:actor.id,model:modelGuard(model),sources:sources.map(s=>({id:s.id,revision:s.revision,digest:sha256(s.value_json)}))}))
 return {review:{...review,digest},guards,sources}
}
export async function applyPolicy(env:Bindings,actor:Authority,value:unknown,previous:number|null,reviewedDigest:unknown) {
 const {review,guards,sources}=await reviewPolicy(env,actor,value,previous)
 if(reviewedDigest!==review.digest)fail('exact_policy_review_required',409)
 const revision=(previous??0)+1,now=new Date().toISOString()
 await transact(env.DB,actor,[...guards.map(assertion),
  sql('INSERT INTO bf_policy_definition_revisions(owner_id,policy_id,revision,document_json,digest,created_at) VALUES(?,?,?,?,?,?)',actor.id,review.document.id,revision,canonicalJson(review.document),review.digest,now),
  ...sources.map(source=>sql('INSERT INTO bf_policy_definition_sources(owner_id,policy_id,revision,dataset_id) VALUES(?,?,?,?)',actor.id,review.document.id,revision,source.id)),
  sql('INSERT INTO bf_policy_definitions(owner_id,id,revision) VALUES(?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision',actor.id,review.document.id,revision),
  policyAudit(actor,review.document.id,revision,review.digest,'apply')])
 return {id:review.document.id,revision,digest:review.digest,active:false as const}
}
