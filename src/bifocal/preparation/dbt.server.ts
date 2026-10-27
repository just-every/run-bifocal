import type { Bindings } from '../../auth.server'
import { assertion, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { sourceMatch } from '../data/snapshots/store'
import type { fileOwner } from '../imports/files/owner.server'
import { readImportedProject, projectGuard } from '../imports/models/store.server'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, type Source } from '../query/types'
import { dbtBindings, dbtDatasets } from './dbt/bindings'
import { executeDBT } from './dbt/execute'

export async function reviewDBT(request:Request,env:Bindings,owner:NonNullable<Awaited<ReturnType<typeof fileOwner>>>,ownerId:string) {
 if(request.method!=='POST')fail('method_not_allowed',405)
 const input=await jsonBody(request);exactKeys(input,['projectId','bindings'])
 if(typeof input.projectId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(input.projectId))fail('model_project_id_required',400)
 const project=await readImportedProject(env,ownerId,input.projectId)
 if(project.value.input.format!=='dbt')fail('dbt_project_required',400)
 const bindings=dbtBindings(input.bindings),sources:Source[]=[]
 for(const dataset of dbtDatasets(bindings)){
  const row=await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<Omit<Source,'table'>>()
  if(!row)fail('preparation_source_unavailable',404)
  sources.push({...row,table:JSON.parse(row.value_json)})
 }
 const result=executeDBT({projectId:project.id,revision:project.revision,resources:project.value.report.project.resources??[],issues:project.value.report.project.issues,bindings},sources)
 const digest=sha256(canonicalJson({ownerId,project:project.revision,bindings,result}))
 await transact(env.DB,owner,[assertion(projectGuard(project)),...sources.map(source=>assertion(sourceMatch(source)))])
 return json({...result,digest,published:false})
}
