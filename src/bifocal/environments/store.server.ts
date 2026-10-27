import {randomUUID} from 'node:crypto'
import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {fail} from '../query/types'
import {estateDocument,type EstateDocument} from './protocol'
import {resolveResources} from './resources.server'
import {promotionQuality} from '../models/validation/quality.server'
export type Estate={owner_id:string;id:string;head_revision:number;development:number;staging:number|null;production:number|null;generation:number}
export type EstateRevision={owner_id:string;estate_id:string;revision:number;document_json:string;definitions_json:string;digest:string;created_at:string}
export const estateGuard=(actor:Authority,id:string,state:Estate|null)=>state?sql('EXISTS(SELECT 1 FROM bf_environment_estates WHERE owner_id=? AND id=? AND head_revision=? AND development=? AND staging IS ? AND production IS ? AND generation=?)',actor.id,id,state.head_revision,state.development,state.staging,state.production,state.generation):sql('NOT EXISTS(SELECT 1 FROM bf_environment_estates WHERE owner_id=? AND id=?)',actor.id,id)
export const readEstate=(env:Bindings,actor:Authority,id:string)=>env.DB.prepare('SELECT * FROM bf_environment_estates WHERE owner_id=? AND id=?').bind(actor.id,id).first<Estate>()
export async function readEstateRevision(env:Bindings,actor:Authority,id:string,n:number){
 const row=await env.DB.prepare('SELECT * FROM bf_environment_revisions WHERE owner_id=? AND estate_id=? AND revision=?').bind(actor.id,id,n).first<EstateRevision>()
 if(!row)fail('environment_revision_not_found',404)
 return row
}
export const history=(actor:Authority,id:string,n:number,environment:string,action:string,digest:string)=>sql('INSERT INTO bf_environment_history(id,owner_id,estate_id,revision,environment,action,actor_id,digest,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,id,n,environment,action,actor.id,digest,new Date().toISOString())
export async function prepareEstateDraft(env:Bindings,actor:Authority,value:unknown,previous:unknown){
 const document=estateDocument(value),state=await readEstate(env,actor,document.id)
 if(previous!==(state?.head_revision??null))fail('stale_environment_revision',409)
 const resources=await resolveResources(env,actor,document),before=state?JSON.parse((await readEstateRevision(env,actor,document.id,state.head_revision)).document_json):null
 const guards=[estateGuard(actor,document.id,state),...resources.guards]
 const digest=sha256(canonicalJson({ownerId:actor.id,kind:'environment-draft',document,previousRevision:previous,definitions:resources.definitions,fingerprints:resources.fingerprints}))
 return {document,state,resources,guards,review:{document,previousRevision:previous,before,after:document,digest,productionSends:0,sourceWrites:0}}
}
export async function saveEstateDraft(env:Bindings,actor:Authority,value:unknown,previous:unknown,reviewedDigest:unknown){
 const prepared=await prepareEstateDraft(env,actor,value,previous),{document,state,resources,guards,review}=prepared,n=(state?.head_revision??0)+1
 if(reviewedDigest!==review.digest)fail('exact_environment_draft_review_required',409)
 await transact(env.DB,actor,[...guards.map(assertion),sql('INSERT INTO bf_environment_revisions(owner_id,estate_id,revision,document_json,definitions_json,digest,created_at) VALUES(?,?,?,?,?,?,?)',actor.id,document.id,n,canonicalJson(document),canonicalJson(resources.definitions),review.digest,new Date().toISOString()),...resources.sourceIds.map(dataset=>sql('INSERT INTO bf_environment_sources(owner_id,estate_id,revision,dataset_id) VALUES(?,?,?,?)',actor.id,document.id,n,dataset)),state?sql('UPDATE bf_environment_estates SET head_revision=?,development=? WHERE owner_id=? AND id=?',n,n,actor.id,document.id):sql('INSERT INTO bf_environment_estates(owner_id,id,head_revision,development) VALUES(?,?,?,?)',actor.id,document.id,n,n),sql('DELETE FROM bf_environment_approval WHERE owner_id=? AND estate_id=?',actor.id,document.id),history(actor,document.id,n,'development','draft',review.digest)])
 return {id:document.id,revision:n,digest:review.digest,state:'draft'}
}
export async function publicationReview(env:Bindings,actor:Authority,id:string,n:number,rollback=false){
 const state=await readEstate(env,actor,id);if(!state)fail('environment_not_found',404)
 const revision=await readEstateRevision(env,actor,id,n),document=JSON.parse(revision.document_json) as EstateDocument
 if(!rollback&&state.development!==n)fail('current_environment_draft_required',409)
 if(rollback&&!await env.DB.prepare("SELECT id FROM bf_environment_history WHERE owner_id=? AND estate_id=? AND revision=? AND environment='production'").bind(actor.id,id,n).first())fail('previous_production_environment_required',409)
 const resources=await resolveResources(env,actor,document,rollback)
 if(canonicalJson(resources.definitions)!==revision.definitions_json)fail('environment_resource_definition_changed',409)
 const before=state.production?JSON.parse((await readEstateRevision(env,actor,id,state.production)).definitions_json) as typeof resources.definitions:[]
 const diff=[...new Set([...before.map(r=>r.key),...resources.definitions.map(r=>r.key)])].map(key=>({key,before:before.find(r=>r.key===key)??null,after:resources.definitions.find(r=>r.key===key)??null})).filter(d=>canonicalJson(d.before)!==canonicalJson(d.after))
 const quality=await promotionQuality(env,resources.sourceIds,actor.id)
 const compatible=resources.models.every(value=>value.review.compatible)&&!quality.impact.blocking,accessReviewRequired=resources.models.some(value=>value.review.accessReviewRequired)
 const content={id,version:n,generation:state.generation,rollback,definitions:resources.definitions,diff,compatible,accessReviewRequired,qualityImpact:quality.impact,modelReviews:resources.models.map(value=>value.review),productionSends:0,sourceWrites:0}
 const digest=sha256(canonicalJson({ownerId:actor.id,...content,fingerprints:resources.fingerprints}))
 return {state,revision,document,resources,guards:[estateGuard(actor,id,state),...resources.guards,...quality.guards],review:{...content,digest}}
}
