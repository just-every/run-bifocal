import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { fileOwner } from '../imports/files/owner.server'
import { projectGuard, readImportedProject } from '../imports/models/store.server'
import { sourceMatch } from '../data/snapshots/store'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, type Source } from '../query/types'
import { executeFlow, flowBindings, flowDatasets } from './flow'
import type { Preparation } from './execute'

type Owner=NonNullable<Awaited<ReturnType<typeof fileOwner>>>
export async function flowReview(env:Bindings,ownerId:string,input:Record<string,unknown>) {
 if(typeof input.projectId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(input.projectId))fail('model_project_id_required',400)
 const project=await readImportedProject(env,ownerId,input.projectId)
 if(!['powerquery','tableau-prep'].includes(project.value.input.format))fail('preparation_flow_project_required',400)
 if(input.revision!==project.revision)fail('stale_flow_project_revision',409)
 if(input.flowId!==undefined&&(typeof input.flowId!=='string'||input.flowId.length>240))fail('flow_id_required',400)
 const bindings=flowBindings(input.bindings),sources:Source[]=[]
 const cycle=await env.DB.prepare(`WITH RECURSIVE parents(id) AS (
  SELECT value FROM json_each(?) UNION SELECT p.dataset_id FROM bf_preparation_output_sources p JOIN parents a ON p.output_id=a.id
 ) SELECT 1 FROM parents a JOIN bf_preparation_outputs o ON o.dataset_id=a.id
 WHERE o.project_id=? LIMIT 1`).bind(canonicalJson(flowDatasets(bindings)),project.id).first()
 if(cycle)fail('flow_project_dependency_cycle',409)
 for(const dataset of flowDatasets(bindings)){
  const row=await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<Omit<Source,'table'>>()
  if(!row)fail('preparation_source_unavailable',404)
  sources.push({...row,table:JSON.parse(row.value_json)})
 }
 const result=executeFlow({projectId:project.id,revision:project.revision,resources:project.value.report.project.resources??[],bindings,...typeof input.flowId==='string'?{flowId:input.flowId}:{}},sources)
 const imported={projectId:project.id,revision:project.revision,flowId:result.imported.flowId!,bindings}
 const document=result.document?{...result.document,imported}:null
 return {result:{...result,document},project,sources,imported}
}

export async function reviewImportedFlow(request:Request,env:Bindings,owner:Owner,ownerId:string) {
 if(request.method!=='POST')fail('method_not_allowed',405)
 const input=await jsonBody(request);exactKeys(input,['projectId','revision','bindings','flowId'])
 const {result,project,sources}=await flowReview(env,ownerId,input)
 await transact(env.DB,owner,[assertion(projectGuard(project)),...sources.map(source=>assertion(sourceMatch(source))),...sources.map(source=>sql('INSERT OR IGNORE INTO bf_model_import_sources(project_id,dataset_id) VALUES(?,?)',project.id,source.id))])
 return json({...result,digest:sha256(canonicalJson({ownerId,result})),published:false})
}

export async function preparationOrigin(env:Bindings,ownerId:string,document:Preparation) {
 if(!document.imported)return []
 const {result,project,sources}=await flowReview(env,ownerId,document.imported)
 if(!result.compatible||result.document?.dataset!==document.dataset)fail('compatible_original_flow_required',409)
 return [assertion(projectGuard(project)),assertion(sql('NOT EXISTS(SELECT 1 FROM bf_preparation_erasing_projects WHERE project_id=?)',project.id)),...sources.map(source=>assertion(sourceMatch(source))),...sources.map(source=>sql('INSERT OR IGNORE INTO bf_model_import_sources(project_id,dataset_id) VALUES(?,?)',project.id,source.id))]
}
