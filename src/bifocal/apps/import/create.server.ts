import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { Authority } from '../../catalog/authority.server'
import { exactKeys } from '../../models/validation/transport'
import { fail } from '../../query/types'
import { appDocument, documentDigest, kinds, appId, type AppDocument, type PageKind } from '../protocol'
import { audit } from '../store.server'
import { importGuard, readAppImport } from './store.server'

type Mapping={kind:PageKind;ref:string}
/** Reviewed mappings only: unmapped content and unresolved principals stay out, and mapped members wait inert for a reviewed publication. */
async function prepare(env:Bindings,actor:Authority,id:string,input:Record<string,unknown>) {
 exactKeys(input,['previousRevision','contentMappings','identityMappings',...('reviewedDigest' in input?['reviewedDigest']:[])])
 const current=await readAppImport(env,actor.id,id)
 if(input.previousRevision!==current.revision)fail('app_import_revision_changed',409)
 const project=current.value,content=input.contentMappings as Record<string,Mapping>|undefined,identities=input.identityMappings as Record<string,{operatorId:string;operatorVersion:number}>|undefined
 if(!content||typeof content!=='object'||!identities||typeof identities!=='object')fail('app_import_mappings_required',400)
 for(const [source,mapping] of Object.entries(content)){
  if(!project.content.some(c=>c.id===source)||!kinds.includes(mapping?.kind))fail('app_import_mapping_invalid',400)
  if(mapping.kind==='scorecard')fail('app_import_mapping_invalid',400)
  appId(mapping.ref)
 }
 const issues=project.audiences.flatMap(a=>a.rowRole?.issues.map(issue=>issue+':'+a.key)??[])
 if(issues.length)fail('app_import_row_role_unresolved',409)
 const pageKey=(sourceId:string)=>'page-'+(project.content.findIndex(c=>c.id===sourceId)+1)
 const pages=project.content.filter(c=>content[c.id]).map(c=>({key:pageKey(c.id),title:c.name,kind:content[c.id].kind,ref:content[c.id].ref}))
 const audiences=project.audiences.flatMap(a=>{
  const mapped=a.contentIds.filter(c=>content[c]).map(pageKey)
  if(!mapped.length)return []
  return [{key:a.key,name:a.name,landing:mapped.includes(pageKey(a.landingId))?pageKey(a.landingId):mapped[0],pages:mapped,rows:a.rowRole?.filters??[],columns:null}]
 })
 const document:AppDocument=appDocument({version:1,title:project.source.name,pages,audiences})
 const members=[] as {audience:string;operatorId:string;operatorVersion:number}[]
 for(const audience of project.audiences)for(const member of audience.members){
  const choice=identities[audience.key+':'+member.identifier]
  if(!choice||!member.candidate||choice.operatorId!==member.candidate.operatorId||choice.operatorVersion!==member.candidate.operatorVersion||!document.audiences.some(a=>a.key===audience.key))continue
  const person=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active' AND role<>'owner'").bind(choice.operatorId).first<{version:number}>()
  if(!person||person.version!==choice.operatorVersion)fail('membership_changed',409)
  members.push({audience:audience.key,operatorId:choice.operatorId,operatorVersion:person.version})
 }
 const digest=sha256(canonicalJson({ownerId:actor.id,import:current.revision,document,members}))
 return {current,project,content,document,members,digest}
}
export async function reviewFromImport(env:Bindings,actor:Authority,id:string,input:Record<string,unknown>) {
 const {current,project,content,document,members,digest}=await prepare(env,actor,id,input)
 await transact(env.DB,actor,[assertion(importGuard(current))])
 return {digest,document,members,unmappedContent:project.content.filter(c=>!content[c.id]).map(c=>c.id),unresolvedPrincipals:project.audiences.flatMap(a=>a.members.filter(m=>!members.some(x=>x.audience===a.key&&x.operatorId===m.candidate?.operatorId)).map(m=>a.key+':'+m.identifier)),unrestrictedAudiences:document.audiences.filter(a=>!a.rows.length).map(a=>a.key),active:false as const}
}
export async function createFromImport(env:Bindings,actor:Authority,id:string,input:Record<string,unknown>) {
 const {current,project,content,document,members,digest}=await prepare(env,actor,id,input)
 if(input.reviewedDigest!==digest)fail('exact_app_import_review_required',409)
 const app=randomUUID(),now=new Date().toISOString()
 await transact(env.DB,actor,[assertion(importGuard(current)),sql('INSERT INTO bf_apps(id,owner_id,draft_json,draft_revision,created_at) VALUES(?,?,?,1,?)',app,actor.id,JSON.stringify(document),now),
  ...members.map(m=>sql('INSERT INTO bf_app_members(app_id,audience,operator_id,operator_version,added_at) VALUES(?,?,?,?,?)',app,m.audience,m.operatorId,m.operatorVersion,now)),
  audit(actor,{id:app,owner_id:actor.id},'draft-created-from-import',id,null,documentDigest(document))])
 return {id:app,draftRevision:1,digest,pages:document.pages.length,audiences:document.audiences.length,mappedMembers:members.length,unmappedContent:project.content.filter(c=>!content[c.id]).map(c=>c.id)}
}
