import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity } from '../data/snapshots/store'
import { readDefinition, readModel, modelGuard } from '../models/validation/store.server'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { QueryError, fail } from '../query/types'
import { rejectedUpload } from '../http/rejected'
import { CalculationError } from './core'
import { calculationScope } from './library/governance.server'
import { compileLibrary } from './library/compile'
import { runLibrary, type RunInput } from './library/run'
import { readCalculationLibrary, libraryGuard } from './library/store.server'
import { calculationImportResponse } from './library/import.server'
import type { LibraryInput } from './library/types'
async function handle(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname
 if(!/^\/api\/operator\/calculations(?:\/|$)/.test(path))return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner)
 if(url.search)fail('query_parameters_not_supported',400)
 if(path==='/api/operator/calculations'){
  if(request.method!=='GET')fail('method_not_allowed',405)
  const models=(await env.DB.prepare('SELECT id FROM bf_semantic_models WHERE owner_id=? AND production IS NOT NULL ORDER BY id LIMIT 101').bind(ownerId).all<{id:string}>()).results
  if(models.length>100)fail('model_catalog_limit',413)
  const views=[],guards=[]
  for(const item of models){const model=await readModel(env,ownerId,item.id),definition=await readDefinition(env,model.production!);guards.push(modelGuard(model));for(const view of definition.views)if(view.query.semantic)views.push({modelId:model.id,revision:model.production,viewId:view.id,fields:view.query.semantic.dimensions.map(d=>({id:d.column,type:d.type})),measures:view.query.measures,fiscal:view.query.fiscal??null,sourceFilters:view.query.filters,rowRules:view.rowRules,hierarchies:view.query.semantic.hierarchies})}
  const libraries=(await env.DB.prepare("SELECT id,revision,json_extract(value_json,'$.input.label') AS label FROM bf_calculation_libraries WHERE owner_id=? ORDER BY id LIMIT 100").bind(ownerId).all()).results
  await transact(env.DB,owner,guards.map(assertion));return json({views,libraries,authority:'installation-owner'})
 }
 if(path==='/api/operator/calculations/review'||path==='/api/operator/calculations/save'){
  if(request.method!=='POST')fail('method_not_allowed',405)
  const body=await jsonBody(request);exactKeys(body,path.endsWith('/save')?['input','reviewedDigest']:['input'])
  const input=body.input as LibraryInput,scope=await calculationScope(env,ownerId,input?.modelId,input?.viewId),library=compileLibrary(input,input.id,ownerId,scope)
  const current=await env.DB.prepare('SELECT revision FROM bf_calculation_libraries WHERE id=?').bind(input.id).first<{revision:string}>()
  const preview=library.report.compatible?runLibrary(library,scope):null,digest=sha256(canonicalJson({library,current:current?.revision??null,preview}))
  await transact(env.DB,owner,scope.guards.map(assertion))
  if(path.endsWith('/review'))return json({digest,report:library.report,preview,input:library.input})
  if(!library.report.compatible||body.reviewedDigest!==digest)fail('exact_calculation_review_required',409)
  // Native authoring uses the same upload, Plan, Apply and reconciliation door
  // as source migration. There is one custody and before-image implementation.
  const invoke=async(action:string,data:unknown)=>{const headers=new Headers(request.headers);headers.set('content-type','application/json');headers.set('Origin',env.AUTH_ORIGIN);headers.set('X-Import-Kind','calculation');headers.set('X-Import-Dataset',input.id);headers.set('X-Calculation-Model',input.modelId);headers.set('X-Calculation-View',input.viewId);headers.delete('content-length');const response=await calculationImportResponse(new Request(new URL('/api/operator/import/'+action,url),{method:'POST',headers,body:JSON.stringify(data)}),env);if(!response?.ok)fail('calculation_shared_import_refused',response?.status??409);return response.json() as Promise<Record<string,any>>}
  const bytes=new TextEncoder().encode(canonicalJson(input)),digestBytes=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join(''),base64=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''))
  const upload=await invoke('uploads',{name:'calculation-library.json',bundleSha256:digestBytes,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digestBytes,base64}),plan=await invoke('plan',{uploadId:upload.uploadId})
  const applied=await invoke('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})
  if(applied.job.state!=='completed')fail('calculation_import_not_complete',409)
  const reconciliation=await invoke('reconcile',{planId:plan.planId});if(!reconciliation.ok)fail('calculation_reconciliation_failed',409)
  const saved=await readCalculationLibrary(env,ownerId,input.id);return json({id:input.id,revision:saved.revision},201)
 }
 const retained=/^\/api\/operator\/calculations\/([a-z][a-z0-9-]{0,63})\/answers\/([a-f0-9-]{36})$/.exec(path)
 if(retained){
  if(request.method!=='GET')fail('method_not_allowed',405)
  const row=await env.DB.prepare('SELECT value_json,digest FROM bf_calculation_runs WHERE id=? AND library_id=? AND owner_id=?').bind(retained[2],retained[1],ownerId).first<{value_json:string;digest:string}>()
  if(!row)fail('calculation_answer_not_found',404)
  if(sha256(row.value_json)!==row.digest)fail('calculation_answer_integrity',409)
  await transact(env.DB,owner,[assertion(sql('EXISTS(SELECT 1 FROM bf_calculation_runs WHERE id=? AND owner_id=? AND value_json=? AND digest=?)',retained[2],ownerId,row.value_json,row.digest))])
  return json(JSON.parse(row.value_json))
 }
 const match=/^\/api\/operator\/calculations\/([a-z][a-z0-9-]{0,63})(?:\/(run))?$/.exec(path)
 if(!match)fail('not_found',404)
 const stored=await readCalculationLibrary(env,ownerId,match[1])
 if(!match[2]){if(request.method!=='GET')fail('method_not_allowed',405);await transact(env.DB,owner,[assertion(libraryGuard(stored))]);return json({id:stored.id,revision:stored.revision,input:stored.value.input,report:stored.value.report})}
 if(request.method!=='POST')fail('method_not_allowed',405)
 const input=await jsonBody(request),{revision,...selection}=input
 if(revision!==stored.revision)fail('calculation_revision_changed',409)
 if(!stored.value.report.compatible)fail('unresolved_calculation_library',409)
 const binding=stored.value.input,scope=await calculationScope(env,ownerId,binding.modelId,binding.viewId),library=compileLibrary(binding,binding.id,ownerId,scope),answer=runLibrary(library,scope,selection as RunInput)
 const {guards,...context}=scope.context,id=randomUUID(),snapshot={id,libraryId:stored.id,revision,answer,context:{...context,modelId:scope.model.id,modelRevision:scope.model.production,viewId:scope.view.id,rowRules:scope.view.rowRules,sourceFilters:scope.view.query.filters,fiscal:scope.view.query.fiscal??null,sources:library.sources},definition:library.input,selection,createdAt:new Date().toISOString()}
 await transact(env.DB,owner,[assertion(libraryGuard(stored)),...scope.guards.map(assertion),sql('INSERT INTO bf_calculation_runs(id,library_id,owner_id,value_json,digest) VALUES(?,?,?,?,?)',id,stored.id,ownerId,canonicalJson(snapshot),sha256(canonicalJson(snapshot)))])
 return json(snapshot,201)
}
export async function calculationResponse(request:Request,env:Bindings):Promise<Response|null>{
 let response
 try{response=await handle(request,env)}catch(error){response=error instanceof QueryError?json({error:error.code},error.status):error instanceof CalculationError?json({error:error.code,path:error.path},422):json({error:'calculation_conflict',reason:'Reload the governed view and review the library again.'},409)}
 return response?rejectedUpload(request,response):null
}
