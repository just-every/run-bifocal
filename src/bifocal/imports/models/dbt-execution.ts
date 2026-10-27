import { executeChecks } from './dbt-checks'
import { projection, bindPredicates, filteredRows } from './dbt-projection'
import { issue, record, text, unknownKeys } from './readers/common'
import type { Project, ProjectResource } from './readers/types'
import type { Filter, Source } from '../../query/types'

export type DBTBinding = {dataset: string; grain: string[]; columns?: Record<string, string>}
type Projection = {columns: Map<string, string>; root: string; resources: Set<string>; filters:Filter[]; rows:Source['table']['rows']}
export type Run = {source: Source; projection: Projection}
const metadata = ['unique_id','name','resource_type','package_name','path','original_file_path','fqn','description','meta','tags','created_at','config','depends_on']

/** Resolve only proven reader obligations. Every other diagnostic survives.
 * Exact reviewed bindings and input files remain unchanged. Results contain
 * identities, revisions, mappings and check counts, never copied source rows. */
export function executeDBT(project: Project, bindings: Record<string, DBTBinding>, sources: Source[]): void {
 if (project.format !== 'dbt') return
 const resources = project.resources ?? [], runs = new Map<string, Run[]>(), valid = new Map<string, boolean>()
 if (!resources.length) return
 const diagnostic = (r: ProjectResource, code: string, message: string) => issue(project,r,r.id,code,message)
 const finish = (r: ProjectResource, result: Record<string, unknown>) => {
  r.definition.translation = result
  project.issues = project.issues.filter(i => !(i.object === r.id && (i.code === 'dbt_resource_execution_pending' || i.code === 'dbt_project_execution_pending')))
 }
 // Configurations are checked even on unused or unsupported resources.
 for (const r of resources) {
  const before = project.issues.length, d = r.definition
  if (d.config !== undefined) {
   if (!record(d.config)) diagnostic(r,'unsupported_dbt_config','Configuration must be an empty mapping or enabled: true; hooks, materializations, filters and adapter settings are unsupported.')
   else for (const [key,value] of Object.entries(d.config)) if (key !== 'enabled' || value !== true) diagnostic(r,'unsupported_dbt_config',`Configuration ${key} needs an explicit translation before publication.`)
  }
  if (r.kind === 'project') {
   unknownKeys(project,r,r.id,d,['name','version','config-version','profile','model-paths','test-paths','analysis-paths','macro-paths','snapshot-paths','seed-paths','clean-targets','target-path'])
   if (d['config-version'] !== undefined && d['config-version'] !== 2) diagnostic(r,'unsupported_dbt_config','Only configuration envelope version 2 is supported.')
   for (const [key,value] of Object.entries(d)) {
    if (['name','version','profile','target-path'].includes(key) && !text(value)) diagnostic(r,'invalid_dbt_config',`Project ${key} must be a literal string.`)
    if (key.endsWith('-paths') || key === 'clean-targets') if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v || /[{}]/.test(v))) diagnostic(r,'invalid_dbt_config',`Project ${key} must contain literal path strings.`)
   }
   if (project.issues.length === before) finish(r,{state:'translated',kind:'inert-project-metadata'})
  } else if (r.kind === 'model') {
   unknownKeys(project,r,r.id,d,[...metadata,'sql','schema','raw_code','raw_sql','compiled_code','compiled_sql','language','columns','database','schema_name','alias','checksum','compiled','build_path','unrendered_config','relation_name','extra_ctes_injected','extra_ctes','contract','access','group','version','latest_version','defer_relation','refs','sources','metrics','docs','patch_path','root_path','doc_blocks','constraints'])
   if (d.language !== undefined && d.language !== 'sql') diagnostic(r,'unsupported_dbt_language','Only literal SQL projections are supported.')
   if (!projection(d.sql ?? d.raw_code ?? d.raw_sql)) diagnostic(r,'unsupported_dbt_sql','Only a complete literal SELECT from one source or ref with supported typed conjunctions is translated; all other SQL remains inert.')
   if (record(d.depends_on) && Array.isArray(d.depends_on.macros) && d.depends_on.macros.length) diagnostic(r,'unsupported_dbt_macros','Model macro dependencies require explicit translation.')
   for (const key of ['compiled_code','compiled_sql']) if (d[key] !== undefined && d[key] !== d.raw_code && d[key] !== d.raw_sql && d[key] !== d.sql) diagnostic(r,'unsupported_dbt_compiled_sql','Compiled SQL needs an exact equivalence proof; supply the literal source projection without a differing compiled artifact.')
   if (record(d.contract) && Object.values(d.contract).some(v => v !== false && v !== null && !(Array.isArray(v) && !v.length))) diagnostic(r,'unsupported_dbt_contract','Model contracts need explicit implementation.')
   if (record(d.unrendered_config) && Object.keys(d.unrendered_config).length || Array.isArray(d.extra_ctes) && d.extra_ctes.length || Array.isArray(d.constraints) && d.constraints.length || d.version != null || d.latest_version != null || d.defer_relation != null) diagnostic(r,'unsupported_dbt_model_options','Versioning, deferred relations, constraints, CTEs and unrendered configuration are unsupported.')
  } else if (r.kind === 'source') {
   unknownKeys(project,r,r.id,d,[...metadata,'source','columns','tests','data_tests','source_name','source_description','database','schema','identifier','loader','loaded_at_field','freshness','quoting','external','unrendered_database','unrendered_schema','unrendered_config','relation_name','patch_path','root_path'])
   for (const key of ['loaded_at_field','freshness','external']) if (d[key] != null) diagnostic(r,'unsupported_dbt_source_options',`Source ${key} requires explicit implementation.`)
   for (const key of ['quoting','unrendered_config']) if (record(d[key]) && Object.keys(d[key]).length) diagnostic(r,'unsupported_dbt_source_options',`Source ${key} requires explicit implementation.`)
  }
  valid.set(r.id, project.issues.length === before)
 }
 const remember = (r: ProjectResource, run: Run) => {
  const list = runs.get(r.id) ?? []
  if (!list.some(item => item.source.id === run.source.id)) list.push(run)
  runs.set(r.id,list)
 }
 const resolve = (r: ProjectResource, source: Source, active = new Set<string>()): Projection | null => {
  if (active.has(r.id)) { diagnostic(r,'cyclic_dbt_dependency','Resolve the dependency cycle.'); return null }
  if (!valid.get(r.id)) return null
  const cached = runs.get(r.id)?.find(run => run.source.id === source.id)
  if (cached) return cached.projection
  if (r.kind === 'source') {
   const declared = r.definition.columns
   const columns = Array.isArray(declared) ? declared : record(declared) ? Object.values(declared) : []
   if (columns.some(column=>!record(column) || typeof column.name!=='string' || !source.table.columns.some(c=>c.name===column.name))) { diagnostic(r,'dbt_source_column_unavailable','Every declared source column must exist in the exact bound native dataset.'); return null }
   const result = {columns:new Map(source.table.columns.map(c => [c.name,c.name])),root:r.id,resources:new Set([r.id]),filters:[],rows:source.table.rows}
   remember(r,{source,projection:result}); return result
  }
  if (r.kind !== 'model') { diagnostic(r,'unsupported_dbt_dependency','A projection may depend only on an uploaded source or model.'); return null }
  const sql = r.definition.sql ?? r.definition.raw_code ?? r.definition.raw_sql, parsed = projection(sql)
  if (!parsed) { diagnostic(r,'unsupported_dbt_sql','Only SELECT physical_column [AS alias], ... FROM a single literal source or ref is supported. Unsupported predicates, joins, expressions, comments, macros and other SQL remain inert.'); return null }
  const candidates = resources.filter(candidate => parsed.kind === 'ref'
   ? candidate.kind === 'model' && candidate.name === parsed.names[0]
   : candidate.kind === 'source' && candidate.name === parsed.names[1] && (candidate.definition.source_name === parsed.names[0] || record(candidate.definition.source) && candidate.definition.source.name === parsed.names[0] || candidate.id === `source.${parsed.names[0]}.${parsed.names[1]}`))
  if (candidates.length !== 1 || r.dependencies.length !== 1 || r.dependencies[0] !== candidates[0].id) { diagnostic(r,'dbt_dependency_mismatch','The literal SQL dependency must match exactly one uploaded dependency identity.'); return null }
  const next = new Set(active); next.add(r.id)
  const input = resolve(candidates[0],source,next); if (!input) return null
  const columns = new Map<string,string>()
  for (const column of parsed.columns) {
   const physical = input.columns.get(column.input)
   if (!physical) { diagnostic(r,'dbt_projection_column_unavailable',`Projection column ${column.input} is absent from its exact dependency.`); return null }
   columns.set(column.output,physical)
  }
  const predicates=bindPredicates(parsed.predicates,input.columns,source)
  if(!predicates){diagnostic(r,'dbt_predicate_binding_mismatch','Every predicate needs an exact dependency column and a matching literal type.');return null}
  const filters=[...input.filters,...predicates]
  if(filters.length>20){diagnostic(r,'dbt_predicate_limit','The complete dependency chain exceeds the supported predicate bound.');return null}
  const result = {columns,root:input.root,resources:new Set([...input.resources,r.id]),filters,rows:filteredRows(source,input.rows,predicates)}
  remember(r,{source,projection:result}); return result
 }
 for (const table of project.tables) {
  const binding = bindings[table.name]
  if (!record(binding) || typeof binding.dataset !== 'string') continue
  const source = sources.find(s => s.id === binding.dataset); if (!source) continue
  const candidates = resources.filter(r => r.kind === 'model' && r.name === (table.sourceTable ?? table.name))
  if (candidates.length !== 1) { issue(project,table,table.name,'dbt_model_reference_unresolved','The semantic model must reference exactly one uploaded dbt SQL model.'); continue }
  const result = resolve(candidates[0],source); if (!result) continue
  for(const explore of project.explores.filter(e=>e.table===table.name))explore.boundFilters=result.filters
  const needed = [...table.dimensions.map(d=>d.column),...table.measures.flatMap(m=>m.column ? [m.column] : [])]
  for (const logical of needed) {
   const actual = binding.columns?.[logical] ?? logical, projected = result.columns.get(logical)
   if (!projected || projected !== actual) issue(project,table,table.name+'.'+logical,'dbt_projection_binding_mismatch','The explicit physical mapping must equal this SQL output’s complete source-column lineage.')
  }
  if (record(binding.columns)) for (const [logical,physical] of Object.entries(binding.columns)) if (result.columns.get(logical)!==physical) issue(project,table,table.name+'.'+logical,'dbt_projection_binding_mismatch','Every supplied column mapping must match an output and its exact source-column lineage.')
  for (const column of Array.isArray(binding.grain) ? binding.grain : []) if (![...result.columns.values()].includes(column)) issue(project,table,table.name,'dbt_grain_not_projected','Every reviewed physical grain column must be retained by the SQL projection.')
  for (const semantic of resources.filter(r=>r.kind==='semantic_models' && r.name===table.name)) if (valid.get(semantic.id)) {
   if (semantic.dependencies.length!==1 || semantic.dependencies[0]!==candidates[0].id) diagnostic(semantic,'dbt_dependency_mismatch','The semantic reference must match its exact manifest model dependency.')
   else finish(semantic,{state:'translated',model:candidates[0].id,dataset:source.id,revision:source.revision})
  }
 }
 for (const r of resources) {
  const executions = runs.get(r.id)
  if (executions?.length) finish(r,{state:'translated',kind:'identity-projection',bindings:executions.map(run=>({dataset:run.source.id,revision:run.source.revision,root:run.projection.root,columns:Object.fromEntries(run.projection.columns),filters:run.projection.filters,rows:run.projection.rows.length}))})
 }
 executeChecks(project,resources,runs,valid,finish,metadata)
 const internal = new Set(project.tables.filter(table=>table.sourceTable===null && !table.measures.length && !bindings[table.name] && resources.some(r=>r.kind==='model' && r.name===table.name && runs.has(r.id))).map(table=>table.name))
 project.tables=project.tables.filter(table=>!internal.has(table.name))
 project.explores=project.explores.filter(explore=>!internal.has(explore.table))
}
