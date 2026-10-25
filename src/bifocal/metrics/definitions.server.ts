import {runtimeBindings,type Bindings} from '../../auth.server'
import {assertion,transact} from '../../modules/import-kit/src/door/store.ts'
import {fileOwner} from '../imports/files/owner.server'
import {ownerIdentity} from '../data/snapshots/store'
import {fail,QueryError} from '../query/types'
import {discardBody,exactKeys,json,jsonBody} from '../models/validation/transport'
import {metricGuard,revision,type MetricRow} from './store.server'
import {prepareMetricDraft,saveMetricDraft} from './drafts.server'

/** Portable definitions confer no certification or installation authority. */
export async function metricDefinitionResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/operator\/metric-definitions\/(review|apply|[a-z][a-z0-9-]{0,63})$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original)
 try{
  const owner=await fileOwner(request,env);if(!owner)return json({error:'owner_required'},401)
  if(url.search)fail('query_parameters_not_supported',400)
  const ownerId=await ownerIdentity(env,owner),operation=match[1]
  if(request.method==='GET'){
   const row=await env.DB.prepare('SELECT * FROM bf_metrics WHERE id=? AND owner_id=?').bind(operation,ownerId).first<MetricRow>()
   if(!row){await transact(env.DB,owner,[]);return json({document:null,revision:null})}
   const head=(await revision(env,row.id,row.head_revision))!
   await transact(env.DB,owner,[assertion(metricGuard(row))])
   return json({document:{version:1,id:row.id,definition:JSON.parse(head.document_json)},revision:head.revision,digest:head.digest,certifiedRevision:row.published_revision,deprecated:!!row.deprecated_at})
  }
  if(request.method!=='POST'||!['review','apply'].includes(operation))fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['document','previousRevision','reviewedDigest'])
  if(!input.document||typeof input.document!=='object'||Array.isArray(input.document))fail('metric_document_required',400)
  const document=input.document as Record<string,unknown>;exactKeys(document,['version','id','definition'])
  if(document.version!==1||typeof document.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(document.id))fail('metric_document_required',400)
  if(input.previousRevision!==null&&(!Number.isSafeInteger(input.previousRevision)||Number(input.previousRevision)<1))fail('metric_revision_required',400)
  const prepared=await prepareMetricDraft(env,ownerId,document.id,document.definition,input.previousRevision)
  if(operation==='review'){await transact(env.DB,owner,prepared.guards.map(assertion));return json(prepared.review)}
  if(input.reviewedDigest!==prepared.review.digest)fail('exact_current_metric_review_required',409)
  return json(await saveMetricDraft(env,owner,prepared),201)
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'metric_definition_conflict'},409)}finally{await discardBody(request)}
}
