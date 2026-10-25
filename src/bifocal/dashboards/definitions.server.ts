import {randomUUID} from 'node:crypto'
import {runtimeBindings,type Bindings} from '../../auth.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {fileOwner} from '../imports/files/owner.server'
import {ownerIdentity,prepareQuery,readSources,sourceMatch} from '../data/snapshots/store'
import {queryInput} from '../query/validate'
import {queryContext} from '../query/context'
import {execute} from '../query/execute'
import {fail,QueryError} from '../query/types'
import {discardBody,exactKeys,json,jsonBody} from '../models/validation/transport'

/** Reviewed creation of an immutable dashboard or report and its answer in one batch. */
export async function dashboardDefinitionResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/operator\/(dashboard|report)-definitions\/(review|create)$/.exec(url.pathname)
 if(!match)return null
 const kind=match[1] as 'dashboard'|'report'
 const env=runtimeBindings(original)
 try{
  const owner=await fileOwner(request,env);if(!owner)return json({error:'owner_required'},401)
  if(request.method!=='POST')fail('method_not_allowed',405)
  if(url.search)fail('query_parameters_not_supported',400)
  const ownerId=await ownerIdentity(env,owner),input=await jsonBody(request);exactKeys(input,['document','reviewedDigest'])
  if(!input.document||typeof input.document!=='object'||Array.isArray(input.document))fail('dashboard_document_required',400)
  const document=input.document as Record<string,unknown>;exactKeys(document,['version','title','definition'])
  if(document.version!==1||typeof document.title!=='string'||!document.title.trim()||document.title.length>160)fail('dashboard_title_required',400)
  const definition=queryInput(document.definition),normalized={version:1,title:document.title,definition},context=await queryContext(env,definition,ownerId),sources=await readSources(env,definition)
  const guards=[...context.guards??[],...sources.map(sourceMatch)],digest=sha256(canonicalJson({ownerId,document:normalized,guards}))
  if(url.pathname.endsWith('/review')){
   const answer=execute(definition,sources,context)
   await transact(env.DB,owner,guards.map(assertion))
   return json({document:normalized,digest,answer})
  }
  if(input.reviewedDigest!==digest)fail('exact_current_dashboard_review_required',409)
  const {snapshot,changes}=prepareQuery(definition,context,sources),id=randomUUID(),createdAt=new Date().toISOString()
  await transact(env.DB,owner,[...changes,sql('INSERT INTO bf_query_artifacts(id,kind,snapshot_id,title,owner_id,created_at) VALUES(?,?,?,?,?,?)',id,kind,snapshot.snapshotId,document.title,ownerId,createdAt)])
  return json({id,kind,title:document.title,artifactCreatedAt:createdAt,...snapshot},201)
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'dashboard_definition_conflict'},409)}finally{await discardBody(request)}
}
