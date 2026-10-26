import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Authority } from '../catalog/authority.server'
import { QueryError, fail } from '../query/types'
import { freezePage, runPage } from './content.server'
import { appDocument, documentDigest, type AppDocument } from './protocol'
import { activateVersion, reviewedMembers, membersGuard } from './scope.server'
import { appGuard, audit, readVersion, versionGuard, type AppRow } from './store.server'

type Issue={audience?:string;page:string;error:string}
const pairLimit=96
/** Every audience page is executed under that audience's row and column rules before review. */
async function preview(env:Bindings,ownerId:string,document:AppDocument) {
 const pairs=document.audiences.flatMap(a=>a.pages.map(page=>({audience:a,page:document.pages.find(p=>p.key===page)!})))
 if(pairs.length>pairLimit)fail('app_audience_page_limit',413)
 const results=[],issues:Issue[]=[],guards=[]
 for(const {audience,page} of pairs) {
  try {
   const run=await runPage(env,ownerId,page,audience)
   guards.push(...run.guards)
   results.push({audience:audience.key,page:page.key,filteredRows:run.cards.reduce((sum,card)=>sum+card.filteredRows,0),totals:run.cards.map(card=>card.totals)})
  }catch(error){if(!(error instanceof QueryError))throw error;issues.push({audience:audience.key,page:page.key,error:error.code})}
 }
 return {results,issues,guards}
}
/** Subscriptions and memberships that the new pointer no longer reaches end with it. */
async function pointerChanges(env:Bindings,app:AppRow,document:AppDocument) {
 const now=new Date().toISOString(),changes=[]
 const subscriptions=(await env.DB.prepare('SELECT id,audience,page_key FROM bf_app_subscriptions WHERE app_id=? AND ended_at IS NULL LIMIT 1001').bind(app.id).all<{id:string;audience:string;page_key:string}>()).results
 if(subscriptions.length>1000)fail('app_subscription_limit',413)
 for(const sub of subscriptions)if(!document.audiences.find(a=>a.key===sub.audience)?.pages.includes(sub.page_key))changes.push(sql("UPDATE bf_app_subscriptions SET ended_at=?,ended_reason='removed-from-version' WHERE id=?",now,sub.id))
 const keep=document.audiences.map(a=>a.key)
 changes.push(sql(`DELETE FROM bf_app_members WHERE app_id=? AND audience NOT IN (${keep.map(()=>'?').join(',')})`,app.id,...keep))
 return changes
}
export async function reviewPublication(env:Bindings,actor:Authority,app:AppRow,draftRevision:unknown) {
 if(draftRevision!==app.draft_revision)fail('app_draft_revision_changed',409)
 const draft=appDocument(JSON.parse(app.draft_json)),issues:Issue[]=[]
 for(const page of draft.pages)if(!draft.audiences.some(a=>a.pages.includes(page.key)))issues.push({page:page.key,error:'app_page_unassigned'})
 const pages=[]
 for(const page of draft.pages){try{pages.push({...page,frozen:await freezePage(env,actor.id,page)})}catch(error){if(!(error instanceof QueryError))throw error;issues.push({page:page.key,error:error.code});pages.push(page)}}
 const document:AppDocument={...draft,pages},version=app.head_version+1
 const run=issues.length?{results:[],issues:[],guards:[]}:await preview(env,actor.id,document)
 issues.push(...run.issues)
 const members=await reviewedMembers(env,app.id),ownerVersion=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{version:number}>()
 const digest=documentDigest(document),reviewDigest=sha256(canonicalJson({ownerId:actor.id,ownerVersion:ownerVersion?.version,appId:app.id,draftRevision:app.draft_revision,previous:app.published_version,version,digest,preview:run.results,members}))
 const previous=app.published_version?(await readVersion(env,app.id,app.published_version)).document:null
 return {version,digest,reviewDigest,document,members,preview:run.results,issues,guards:[...run.guards,membersGuard(app.id,members)],
  changes:{pagesAdded:document.pages.filter(p=>!previous?.pages.some(q=>q.key===p.key)).map(p=>p.key),pagesRemoved:(previous?.pages??[]).filter(p=>!document.pages.some(q=>q.key===p.key)).map(p=>p.key),audiencesAdded:document.audiences.filter(a=>!previous?.audiences.some(b=>b.key===a.key)).map(a=>a.key),audiencesRemoved:(previous?.audiences??[]).filter(a=>!document.audiences.some(b=>b.key===a.key)).map(a=>a.key)}}
}
export async function publish(env:Bindings,actor:Authority,app:AppRow,draftRevision:unknown,reviewedDigest:unknown) {
 const review=await reviewPublication(env,actor,app,draftRevision)
 if(review.issues.length)fail('app_publication_issues',409)
 if(reviewedDigest!==review.reviewDigest)fail('exact_app_publication_review_required',409)
 const now=new Date().toISOString(),version=review.version,activation=await activateVersion(env,actor,app.id,version,review.document)
 await transact(env.DB,actor,[assertion(appGuard(app)),...review.guards.map(assertion),...activation.guards.map(assertion),
  sql("INSERT INTO bf_app_versions(app_id,version,document_json,digest,action,restores,actor_id,created_at) VALUES(?,?,?,?,'publish',NULL,?,?)",app.id,version,canonicalJson(review.document),review.digest,actor.id,now),
  sql('UPDATE bf_apps SET head_version=?,published_version=? WHERE id=?',version,version,app.id),
  ...activation.changes,...await pointerChanges(env,app,review.document),audit(actor,app,'publish',null,version,review.digest)])
 return {version,digest:review.digest}
}
export async function reviewRollback(env:Bindings,actor:Authority,app:AppRow,target:unknown,previousPublished:unknown) {
 if(!Number.isSafeInteger(target)||!app.published_version||previousPublished!==app.published_version||target===app.published_version)fail('app_rollback_target_required',409)
 const restored=await readVersion(env,app.id,Number(target)),run=await preview(env,actor.id,restored.document)
 const members=await reviewedMembers(env,app.id),ownerVersion=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{version:number}>()
 const version=app.head_version+1,reviewDigest=sha256(canonicalJson({ownerId:actor.id,ownerVersion:ownerVersion?.version,appId:app.id,previous:app.published_version,restores:restored.version,digest:restored.digest,version,preview:run.results,members}))
 return {version,members,restores:restored.version,digest:restored.digest,reviewDigest,document:restored.document,preview:run.results,issues:run.issues,guards:[versionGuard(restored),membersGuard(app.id,members),...run.guards]}
}
export async function rollback(env:Bindings,actor:Authority,app:AppRow,target:unknown,previousPublished:unknown,reviewedDigest:unknown) {
 const review=await reviewRollback(env,actor,app,target,previousPublished)
 if(review.issues.length)fail('app_rollback_issues',409)
 if(reviewedDigest!==review.reviewDigest)fail('exact_app_rollback_review_required',409)
 const activation=await activateVersion(env,actor,app.id,review.version,review.document)
 await transact(env.DB,actor,[assertion(appGuard(app)),...review.guards.map(assertion),...activation.guards.map(assertion),
  sql("INSERT INTO bf_app_versions(app_id,version,document_json,digest,action,restores,actor_id,created_at) VALUES(?,?,?,?,'rollback',?,?,?)",app.id,review.version,canonicalJson(review.document),review.digest,review.restores,actor.id,new Date().toISOString()),
  sql('UPDATE bf_apps SET head_version=?,published_version=? WHERE id=?',review.version,review.version,app.id),
  ...activation.changes,...await pointerChanges(env,app,review.document),audit(actor,app,'rollback',String(review.restores),review.version,review.digest)])
 return {version:review.version,restores:review.restores}
}
