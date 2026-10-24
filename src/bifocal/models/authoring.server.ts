import { projectGuard, readImportedProject } from '../imports/models/store.server'
import { randomUUID } from 'node:crypto'
import { load, dump, JSON_SCHEMA } from 'js-yaml'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity, readSources, sourceMatch } from '../data/snapshots/store'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, QueryError, type Answer } from '../query/types'
import { definitionInput, scopedQuery } from './validation/protocol'
import { readModel, readBranch, readDefinition, modelGuard, branchGuard, revisionStatement } from './validation/store.server'
import { discardBody, exactKeys, json, jsonBody, privateHeaders } from './validation/transport'

function nativeDocument(document:unknown) {
 if(typeof document!=='string'||!document.trim()||document.length>48000)fail('bounded_yaml_document_required',400)
 // Native documents are values only. Anchors and aliases are unnecessary for
 // git review and are refused before parsing to bound expansion.
 if(/(^|[\s,[{])[*&][A-Za-z0-9_-]+/m.test(document))fail('yaml_aliases_not_supported',400)
 let value:unknown
 try{value=load(document,{schema:JSON_SCHEMA,json:false})}catch{fail('invalid_native_yaml',400)}
 return definitionInput(value)
}
export async function modelAuthoringResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url), path=url.pathname
 if(!path.startsWith('/api/operator/model-authoring'))return null
 const env=runtimeBindings(original)
 try {
  const owner=await fileOwner(request,env);if(!owner)return json({error:'owner_required'},401)
  const ownerId=await ownerIdentity(env,owner)
  if(url.search)fail('query_parameters_not_supported',400)
  if(path==='/api/operator/model-authoring'&&request.method==='GET') {
   const datasets=(await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables ORDER BY id LIMIT 101').all<{id:string;revision:string;value_json:string}>()).results
   const branches=(await env.DB.prepare('SELECT b.*,m.production,m.staging FROM bf_semantic_branches b JOIN bf_semantic_models m ON m.id=b.model_id WHERE m.owner_id=? ORDER BY b.rowid DESC LIMIT 101').bind(ownerId).all()).results
   if(datasets.length>100||branches.length>100)fail('model_catalog_limit',413)
   await transact(env.DB,owner,[])
   return json({datasets:datasets.map(d=>({id:d.id,revision:d.revision,columns:JSON.parse(d.value_json).columns})),branches})
  }
  const download=/^\/api\/operator\/model-authoring\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/document$/.exec(path)
  if(download&&request.method==='GET') {
   const model=await readModel(env,ownerId,download[1]),branch=await readBranch(env,model,download[2]),definition=await readDefinition(env,branch.revision_id)
   await transact(env.DB,owner,[assertion(modelGuard(model)),assertion(branchGuard(branch))])
   return new Response(dump(definition,{schema:JSON_SCHEMA,noRefs:true,lineWidth:100}),{headers:{...privateHeaders,'content-type':'application/octet-stream','content-disposition':'attachment; filename="bifocal-model.yaml"'}})
  }
  if(!['/api/operator/model-authoring/review','/api/operator/model-authoring/create','/api/operator/model-authoring/format'].includes(path))fail('not_found',404)
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['document','reviewedDigest','modelId','branchId','previousVersion','importProject','importRevision'])
  const definition=nativeDocument(input.document), guards=[], impacts:{view:string;state:string;answer?:Answer;error?:string}[]=[]
  if(path.endsWith('/format')){await transact(env.DB,owner,[]);return json({document:dump(definition,{schema:JSON_SCHEMA,noRefs:true,lineWidth:100})})}
  const imported=input.importProject===undefined?null:await readImportedProject(env,ownerId,String(input.importProject))
  if(imported){
   if(input.importRevision!==imported.revision||!imported.value.report.compatible||canonicalJson(definition)!==canonicalJson(imported.value.definition))fail('exact_compatible_project_required',409)
   guards.push(projectGuard(imported))
  }else if(input.importRevision!==undefined)fail('import_project_required',400)
  const model=input.modelId===undefined?null:await readModel(env,ownerId,String(input.modelId))
  const branch=model?await readBranch(env,model,String(input.branchId)):null
  if(branch){if(input.previousVersion!==branch.version)fail('stale_branch_version',409);guards.push(modelGuard(model!),branchGuard(branch))}
  else if(input.branchId!==undefined||input.previousVersion!==undefined)fail('model_branch_required',400)
  for(const view of definition.views) {
   if(!view.query.semantic)fail('explicit_model_grain_required',400)
   if(view.query.joins.some(join=>!join.cardinality))fail('explicit_relationship_cardinality_required',400)
   const query=scopedQuery(view,'native-review'), context=await queryContext(env,query,ownerId), sources=await readSources(env,query)
   guards.push(...context.guards??[],...sources.map(sourceMatch))
   try{impacts.push({view:view.id,state:'compiled',answer:execute(query,sources,context)})}catch(error){if(!(error instanceof QueryError))throw error;impacts.push({view:view.id,state:'failed',error:error.code})}
  }
  const quality=definition.quality.map(q=>({...q,passed:impacts.find(i=>i.view===q.view)?.answer?.totals[q.measure]?.value===q.expected}))
  const compatible=impacts.every(i=>i.state==='compiled')&&quality.every(q=>q.passed)
  const report={definition,impacts,quality,compatible,imported:imported?{id:imported.id,revision:imported.revision,digest:imported.value.digest,format:imported.value.input.format,report:imported.value.report}:null,scope:'Owner-only native model. Imported source definitions retain explicit compatibility and provenance. Slowly changing dimensions use explicit half-open effective-date relationships; overlapping history is refused.'}
  const digest=sha256(canonicalJson({ownerId,report,guards}))
  if(path.endsWith('/review')){await transact(env.DB,owner,guards.map(assertion));return json({...report,digest})}
  if(!compatible||input.reviewedDigest!==digest)fail('exact_current_model_review_required',409)
  const origin=imported?{project_id:imported.id,project_revision:imported.revision,format:imported.value.input.format,digest:imported.value.digest}:branch?await env.DB.prepare('SELECT project_id,project_revision,format,digest FROM bf_model_revision_imports WHERE revision_id=?').bind(branch.revision_id).first<{project_id:string;project_revision:string;format:string;digest:string}>():null
  const provenance=(revisionId:string)=>origin?[sql('INSERT INTO bf_model_revision_imports(revision_id,project_id,project_revision,format,digest) VALUES(?,?,?,?,?)',revisionId,origin.project_id,origin.project_revision,origin.format,origin.digest)]:[]
  if(model&&branch){
   const revision=revisionStatement(model.id,definition)
   await transact(env.DB,owner,[...guards.map(assertion),revision.statement,...provenance(revision.id),sql('UPDATE bf_semantic_branches SET revision_id=?,version=version+1,base_generation=?,approval_json=NULL WHERE id=?',revision.id,model.generation,branch.id)])
   return json({modelId:model.id,branchId:branch.id,revision:revision.id,version:branch.version+1},201)
  }
  const modelId=randomUUID(),branchId=randomUUID(),revision=revisionStatement(modelId,definition)
  await transact(env.DB,owner,[...guards.map(assertion),sql('INSERT INTO bf_semantic_models(id,owner_id) VALUES(?,?)',modelId,ownerId),revision.statement,...provenance(revision.id),sql('INSERT INTO bf_semantic_branches(id,model_id,base_generation,revision_id) VALUES(?,?,0,?)',branchId,modelId,revision.id)])
  return json({modelId,branchId,revision:revision.id,version:1},201)
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'model_authoring_conflict',reason:'Reload current source data and review again. Nothing was published.'},409)}finally{await discardBody(request)}
}
