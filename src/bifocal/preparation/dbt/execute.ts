import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { fail, QueryError, type Source, type Cell } from '../../query/types'
import { dbtBindings } from './bindings'
import { dbtConfiguration } from './configuration'
import { dbtSelect } from './parser'
import { projectDBT } from './expressions'
import { runDBTTest } from './tests'
import type { DBTInput, Diagnostic, Frame, TestResult } from './types'

const ordered=(values:string[])=>[...values].sort((a,b)=>a<b?-1:a>b?1:0)
const bytes=(v:unknown)=>new TextEncoder().encode(canonicalJson(v)).length
const bounded=(frame:Frame)=>{if(frame.columns.length>64||frame.rows.length>10000||bytes(frame)>1500000)fail('dbt_result_limit');return frame}

/** Explicit, synchronous owner review of a closed native dialect. This is not
 * a dbt runtime: it cannot fetch, evaluate Jinja, use adapters or dispatch jobs.
 * The caller authenticates, supplies exact imported resources and file Sources,
 * and guards the project and source revisions before releasing the review. */
export function executeDBT(input:DBTInput,sources:Source[]) {
 // Native execution resolves only the intake placeholders for executable
 // resources. Structural and unsupported-item diagnostics remain blocking.
 const pending=new Set(['dbt_project_execution_pending','dbt_resource_execution_pending'])
 const bindings=dbtBindings(input.bindings),diagnostics:Diagnostic[]=input.issues.filter(issue=>!pending.has(issue.code)).map(issue=>({resource:issue.object,code:issue.code,file:issue.file,message:issue.message})),tests:TestResult[]=[],order:string[]=[]
 const models=new Map<string,Frame>(),frames=new Map<string,Frame>(),resources=new Map(input.resources.map(r=>[r.id,r]))
 const failed=new Set<string>(),active=new Set<string>(),complete=new Set<string>()
 const diagnostic=(resource:string,code:string,message=code)=>{failed.add(resource);diagnostics.push({resource,code,file:resources.get(resource)?.file??'',message})}
 if(input.resources.length>512||resources.size!==input.resources.length)diagnostic('project','bounded_unique_dbt_resources_required')
 if(!input.resources.some(r=>r.kind==='model'))diagnostic('project','no_executable_dbt_models')
 for(const id of ordered(Object.keys(bindings)))if(resources.get(id)?.kind!=='source')diagnostic(id,'dbt_binding_source_not_found')
 const visit=(id:string)=>{
  if(active.has(id)){diagnostic(id,'cyclic_dbt_dependency');return}
  if(complete.has(id))return
  const resource=resources.get(id)
  if(!resource){diagnostic(id,'missing_dbt_dependency');complete.add(id);return}
  active.add(id)
  for(const dependency of ordered(resource.dependencies))visit(dependency)
  active.delete(id);complete.add(id);order.push(id)
 }
 if(input.resources.length<=512)for(const id of ordered([...resources.keys()]))visit(id)
 let projectBlocked=diagnostics.length>0
 for(const resource of input.resources.filter(r=>r.kind==='project')){
  try{dbtConfiguration(resource)}catch(error){diagnostic(resource.id,error instanceof QueryError?error.code:'unsupported_dbt_configuration');projectBlocked=true}
 }
 let outputBytes=0
 for(const id of order){
  const resource=resources.get(id)!
  if(failed.has(id)||resource.kind==='project')continue
  try{
   if(projectBlocked)fail('dbt_project_configuration_blocked')
   if(resource.dependencies.some(d=>failed.has(d)))fail('dbt_dependency_failed')
   dbtConfiguration(resource)
   if(resource.kind==='source'){
    const source=sources.find(s=>s.id===bindings[id])
    if(!source)fail('dbt_explicit_source_binding_required')
    const frame:Frame={columns:structuredClone(source.table.columns),rows:structuredClone(source.table.rows) as Cell[][],lineage:Object.fromEntries(source.table.columns.map(c=>[c.name,[{dataset:source.id,revision:source.revision,column:c.name}]]))}
    frames.set(id,bounded(frame))
   }else if(resource.kind==='model'){
    const select=dbtSelect(resource.definition.sql)
    if(resource.dependencies.length!==1||resource.dependencies[0]!==select.relation)fail('dbt_dependency_sql_mismatch')
    const source=frames.get(select.relation)
    if(!source)fail('dbt_dependency_failed')
    const frame=bounded(projectDBT(select,source));outputBytes+=bytes(frame)
    if(outputBytes>1500000)fail('dbt_project_result_limit')
    frames.set(id,frame);models.set(id,frame)
   }else if(resource.kind==='test'){
    const result=runDBTTest(resource,models);tests.push(result)
    if(result.status==='failed')diagnostic(id,'dbt_test_failed',`${result.test} found ${result.failures} failing rows in ${result.model}.${result.column}.`)
   }else fail('unsupported_dbt_resource')
  }catch(error){diagnostic(id,error instanceof QueryError?error.code:'dbt_execution_failed')}
 }
 return {compatible:diagnostics.length===0,error:diagnostics.length?{resource:diagnostics[0].resource,code:diagnostics[0].code}:null,diagnostics,order,outputs:Object.fromEntries(models),tests,sources:ordered([...new Set(Object.values(bindings))]).map(dataset=>({dataset,revision:sources.find(s=>s.id===dataset)?.revision??null})),project:{id:input.projectId,revision:input.revision}}
}
