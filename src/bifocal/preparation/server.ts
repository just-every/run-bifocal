import { rejectedUpload } from '../http/rejected'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity, sourceMatch } from '../data/snapshots/store'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError, type Source } from '../query/types'
import { preparationSQL, preparationFromSQL } from './sql'
import { reviewDBT } from './dbt.server'
import { preparationImpact } from './impact.server'
import { preparationCheckStatements } from './checks.server'
import { preparationInput, preparationDatasets, executePreparation } from './execute'

type Head={id:string;owner_id:string;version:number}
type Revision={version:number;document_json:string;sources_json:string;digest:string;lineage_json:string;created_at:string}
/** Owner-only synchronous draft execution. No source write, publication,
 * certification, provider execution or background dispatch is available. */
async function handlePreparation(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/operator\/preparations(?:\/([a-z][a-z0-9-]{0,63})(?:\/(review|save|restore|dbt-review))?)?$/.exec(url.pathname)
 if(!url.pathname.startsWith('/api/operator/preparations'))return null
 try{
  const env=runtimeBindings(original),owner=await fileOwner(request,env);if(!owner)return json({error:'owner_required'},401)
  if(!match||url.search)fail('not_found',404)
  const ownerId=await ownerIdentity(env,owner),id=match[1],action=match[2]
  if(!id)fail('preparation_id_required',400)
  if(action==='dbt-review')return await reviewDBT(request,env,owner,ownerId)
  const head=await env.DB.prepare('SELECT * FROM bf_preparations WHERE id=? AND owner_id=?').bind(id,ownerId).first<Head>()
  const headGuard=head?sql('EXISTS(SELECT 1 FROM bf_preparations WHERE id=? AND owner_id=? AND version=?)',id,ownerId,head.version):sql('NOT EXISTS(SELECT 1 FROM bf_preparations WHERE id=?)',id)
  if(!action){
   if(request.method!=='GET')fail('method_not_allowed',405)
   if(!head)fail('preparation_not_found',404)
   const revisions=(await env.DB.prepare('SELECT version,document_json,sources_json,digest,lineage_json,created_at FROM bf_preparation_revisions WHERE preparation_id=? ORDER BY version').bind(id).all<Revision>()).results
   await transact(env.DB,owner,[assertion(headGuard)])
   return json({id,version:head.version,revisions:revisions.map(r=>({version:r.version,document:JSON.parse(r.document_json),sources:JSON.parse(r.sources_json),digest:r.digest,lineage:JSON.parse(r.lineage_json),createdAt:r.created_at})),published:false})
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['document','dataset','sql','previousVersion','reviewedDigest','restoreVersion'])
  if(input.previousVersion!==(head?.version??null))fail('stale_preparation_version',409)
  if(input.sql!==undefined){if(input.document!==undefined||action==='restore')fail('one_preparation_form_required',400);input.document=preparationFromSQL(input.dataset,input.sql)}
  else if(input.dataset!==undefined)fail('preparation_sql_required',400)
  if((action==='restore')!==(input.restoreVersion!==undefined)||action!=='restore'&&input.document===undefined||action==='restore'&&input.document!==undefined)fail('preparation_document_required',400)
  const restoring=action==='restore'?await env.DB.prepare('SELECT * FROM bf_preparation_revisions WHERE preparation_id=? AND version=?').bind(id,input.restoreVersion).first<Revision>():null
  if(action==='restore'&&!restoring)fail('preparation_revision_not_found',404)
  const document=preparationInput(restoring?JSON.parse(restoring.document_json):input.document),sources:Source[]=[]
  for(const dataset of preparationDatasets(document)){
   const row=await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<Omit<Source,'table'>>()
   if(!row)fail('preparation_source_unavailable',404)
   sources.push({...row,table:JSON.parse(row.value_json)})
  }
  const sqlForm=preparationSQL(document)
  const pins=sources.map(s=>({dataset:s.id,revision:s.revision})),result=executePreparation(document,sources),digest=sha256(canonicalJson({id,ownerId,version:head?.version??null,document,pins,result}))
  const guards=[assertion(headGuard),...sources.map(s=>assertion(sourceMatch(s)))]
  if(action==='review'){
   const {impact,guards:impactGuards}=await preparationImpact(env,ownerId,document,sources,result)
   await transact(env.DB,owner,[...guards,...impactGuards.map(assertion),...await preparationCheckStatements(env,ownerId,id,sources,result)])
   return json({id,digest,sources:pins,document,sql:sqlForm,...result,impact,published:false})
  }
  // Failed definitions may be inspected, but never replace a working revision.
  if(!result.compatible||input.reviewedDigest!==digest)fail('exact_current_preparation_review_required',409)
  if(restoring&&canonicalJson(pins)!==restoring.sources_json)fail('preparation_restore_source_changed',409)
  const version=(head?.version??0)+1
  if(version>100)fail('preparation_revision_limit',413)
  await transact(env.DB,owner,[...guards,...head?[sql('UPDATE bf_preparations SET version=? WHERE id=?',version,id)]:[sql('INSERT INTO bf_preparations(id,owner_id,version) VALUES(?,?,?)',id,ownerId,version)],sql('INSERT INTO bf_preparation_revisions(preparation_id,version,document_json,sources_json,digest,lineage_json,created_at) VALUES(?,?,?,?,?,?,?)',id,version,canonicalJson(document),canonicalJson(pins),digest,canonicalJson({columns:result.output!.columns,lineage:result.output!.lineage}),new Date().toISOString()),...sources.map(s=>sql('INSERT OR IGNORE INTO bf_preparation_sources(preparation_id,dataset_id) VALUES(?,?)',id,s.id))])
  return json({id,version,digest,document,sql:sqlForm,...result,published:false},201)
 }catch(error){return error instanceof QueryError?json({error:error.code},error.status):json({error:'preparation_conflict',reason:'Reload the current draft and source records, then review again.'},409)}
}

export async function preparationResponse(request:Request,env:Bindings):Promise<Response|null>{
 const response=await handlePreparation(request,env)
 return response?rejectedUpload(request,response):null
}
