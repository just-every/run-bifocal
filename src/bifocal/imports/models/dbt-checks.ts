import { issue, record, text, unknownKeys } from './readers/common'
import type { Project, ProjectResource } from './readers/types'
import type { Run } from './dbt-execution'

function exactValue(value: unknown, numeric: boolean): string {
 if (numeric && typeof value === 'string') {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (match) {
   const whole = match[2].replace(/^0+(?=\d)/,''), fraction = (match[3] ?? '').replace(/0+$/,'')
   return `decimal:${whole === '0' && !fraction ? '' : match[1]}${whole}${fraction ? '.'+fraction : ''}`
  }
 }
 return JSON.stringify(value)
}

export function executeChecks(project: Project, resources: ProjectResource[], runs: Map<string, Run[]>, valid: Map<string,boolean>, finish: (r: ProjectResource, result: Record<string,unknown>)=>void, metadata:string[]) {
 for (const r of resources.filter(resource=>resource.kind==='test')) {
  const fail = (code: string, message: string) => issue(project,r,r.id,code,message)
  if (!valid.get(r.id)) continue
  const d = r.definition
  let name: string | null = null, column: unknown = d.column
  if ('test' in d) {
   if (typeof d.test === 'string') name=d.test
   else if (record(d.test) && Object.keys(d.test).length===1) {
    const entry=Object.entries(d.test)[0]; name=entry[0]
    if (!record(entry[1]) || Object.keys(entry[1]).length) name=null
   }
  } else if (record(d.test_metadata)) {
   const test=d.test_metadata, args=test.kwargs
   if ((!test.namespace || test.namespace==='dbt') && record(args) && Object.keys(args).every(key=>key==='column_name')) { name=text(test.name); column=args.column_name }
   unknownKeys(project,r,r.id,d,[...metadata,'test_metadata','column_name','raw_code','raw_sql','compiled_code','compiled_sql','language','database','schema','alias','checksum','compiled','build_path','unrendered_config','relation_name','extra_ctes_injected','extra_ctes','refs','sources','metrics','docs','patch_path','root_path','doc_blocks','attached_node','file_key_name'])
   const sql=d.raw_code ?? d.raw_sql
   const template=typeof sql==='string' ? /^\s*\{\{\s*test_(not_null|unique)\(\*\*_dbt_generic_test_kwargs\)\s*\}\}\s*$/.exec(sql) : null
   if (sql!==undefined && template?.[1]!==name || d.compiled_code!=null && d.compiled_code!=='' || d.compiled_sql!=null && d.compiled_sql!=='') name=null
   if (record(d.depends_on) && Array.isArray(d.depends_on.macros) && d.depends_on.macros.some(m=>m!==`macro.dbt.test_${name}` && m!==`macro.dbt.default__test_${name}`)) name=null
  }
  if (!['not_null','unique'].includes(name ?? '') || typeof column!=='string' || r.dependencies.length!==1) { fail('unsupported_dbt_test','Only unconfigured built-in not_null and unique tests on one explicit column are executed; custom tests, arguments, filters and severities remain unsupported.'); continue }
  const targets=runs.get(r.dependencies[0])
  if (!targets?.length) { fail('dbt_test_source_unbound','Bind and prove the exact test dependency before running its checks.'); continue }
  const results: Record<string,unknown>[]=[]
  for (const run of targets) {
   const physical=run.projection.columns.get(column), index=run.source.table.columns.findIndex(c=>c.name===physical)
   if (index<0) { fail('dbt_test_column_unavailable','The test column is not retained by the exact dependency projection.'); continue }
   const numeric=['number','money'].includes(run.source.table.columns[index].type), seen=new Set<string>()
   let failures=0
   for (const row of run.source.table.rows) {
    const value=row[index]
    if (value===null) { if (name==='not_null') failures++; continue }
    if (name==='unique') { const key=exactValue(value,numeric); if (seen.has(key)) failures++; else seen.add(key) }
   }
   results.push({dataset:run.source.id,revision:run.source.revision,column:physical,rows:run.source.table.rows.length,failures})
   if (failures) fail('dbt_quality_check_failed',`${name} failed on ${failures} reviewed source record(s); publication is blocked.`)
  }
  if (results.length===targets.length) finish(r,{state:'executed',test:name,results})
 }
}
