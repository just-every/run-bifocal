import { issue, objects, provenance, record, text, unknownKeys, yaml } from './common'
import { readSemanticYAML } from './semantic-yaml'
import type { Project, ProjectFile, ProjectResource } from './types'

/** Project definitions are inert inventory. Neither Jinja nor SQL nor tests
 * run with installation authority. Execution must be implemented separately. */
export function readDBT(p: Project, files: ProjectFile[]) {
 const resources: ProjectResource[] = [], semantic: ProjectFile[] = []
 const add = (file: ProjectFile, id: string, name: string, kind: string, definition: Record<string, unknown>, dependencies: string[], source = definition) => {
  const at = provenance(file, source)
  if (resources.length >= 512) { if (!p.issues.some(i => i.code === 'dbt_resource_limit')) issue(p, at, 'project', 'dbt_resource_limit', 'The project inventory is limited to 512 resources; this project cannot be published.'); return }
  if (resources.some(r => r.id === id)) issue(p, at, id, 'duplicate_resource', 'Resolve duplicate dbt resource identities.')
  resources.push({...at, id, name, kind, definition, dependencies})
 }
 const manifest = files.find(f => /(?:^|\/)manifest\.json$/i.test(f.path))
 if (files.filter(f => /(?:^|\/)manifest\.json$/i.test(f.path)).length > 1) issue(p, provenance(manifest!, ''), 'manifest', 'duplicate_manifest', 'Supply one project manifest.')
 if (manifest) {
  let value: unknown
  try { value = JSON.parse(manifest.content) } catch { /* reported below */ }
  const at = provenance(manifest, '')
  if (!record(value) || !record(value.metadata) || typeof value.metadata.dbt_schema_version !== 'string' || !/^https:\/\/schemas\.getdbt\.com\/dbt\/manifest\/v(?:9|10|11|12)\.json$/.test(value.metadata.dbt_schema_version) || !record(value.nodes) || !record(value.sources)) {
   issue(p, at, 'manifest', 'invalid_dbt_manifest', 'Supply a dbt manifest with schema version 9 through 12, node and source mappings.')
  } else {
   for (const [id, node] of Object.entries({...value.sources, ...value.nodes})) {
    if (!record(node) || node.unique_id !== id || !text(node.name) || !text(node.resource_type) || !record(node.depends_on) && node.resource_type !== 'source') {
     issue(p, at, id, 'invalid_dbt_resource', 'A resource needs its exact identity, name, type and dependency list.'); continue
    }
    const dependencies = record(node.depends_on) ? node.depends_on.nodes : []
    if (!Array.isArray(dependencies) || dependencies.some(v => typeof v !== 'string')) { issue(p, at, id, 'invalid_dbt_dependencies', 'Dependencies must be resource identities.'); continue }
    add(manifest, id, node.name as string, node.resource_type as string, node, dependencies as string[])
   }
   // These collections affect project semantics even though they are not SQL
   // models. Retain every item and refuse a compatibility claim for it.
   for (const group of ['macros','exposures','metrics','semantic_models','saved_queries','unit_tests','disabled']) {
    const collection = value[group]
    if (collection === undefined) continue
    if (!record(collection)) { issue(p, at, group, 'invalid_dbt_collection', 'Expected a resource mapping.'); continue }
    for (const [id, node] of Object.entries(collection)) {
     const entries = Array.isArray(node) ? node : [node]
     for (const [index, entry] of entries.entries()) {
      if (!record(entry)) { issue(p, at, id, 'invalid_dbt_resource', 'Expected a resource object.'); continue }
      const deps = record(entry.depends_on) && Array.isArray(entry.depends_on.nodes) ? entry.depends_on.nodes : []
      if (deps.some(v => typeof v !== 'string')) { issue(p, at, id, 'invalid_dbt_dependencies', 'Dependencies must be resource identities.'); continue }
      add(manifest, group === 'disabled' ? `${id}:disabled:${index}` : id, String(entry.name ?? id), group, entry, deps as string[])
     }
    }
   }
  }
 }
 // A manifest is the authoritative resolved graph. With source-only projects,
 // inventory literal ref and source calls but never claim Jinja compilation.
 for (const file of [...files].sort((a, b) => Number(/\.sql$/i.test(b.path)) - Number(/\.sql$/i.test(a.path)))) {
  if (file === manifest) continue
  const at = provenance(file, file.content)
  if (/\.sql$/i.test(file.path)) {
   if (manifest) continue
   const name = file.path.split('/').at(-1)!.replace(/\.sql$/i, '')
   const kind = /(?:^|\/)tests\//.test(file.path) ? 'test' : /(?:^|\/)macros\//.test(file.path) ? 'macro' : /(?:^|\/)snapshots\//.test(file.path) ? 'snapshot' : /(?:^|\/)analyses\//.test(file.path) ? 'analysis' : 'model'
   const dependencies = [...file.content.matchAll(/\{\{\s*(ref|source)\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2(?:\s*,\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\4)?\s*\)\s*\}\}/g)].map(m => m[1] === 'source' ? `source.${m[3]}.${m[5] ?? ''}` : `model.${m[5] ?? m[3]}`)
   add(file, `${kind}.${name}`, name, kind, {sql: file.content}, [...new Set(dependencies)])
   continue
  }
  if (!/\.ya?ml$/i.test(file.path)) { issue(p, at, file.path, 'unsupported_dbt_file', 'Supply project YAML, SQL source or a manifest. Other files are retained but never evaluated.'); continue }
  const root = yaml(p, file); if (!root) continue
  if (/(?:^|\/)dbt_project\.ya?ml$/i.test(file.path)) {
   add(file, 'project', String(root.name ?? 'project'), 'project', root, [])
   issue(p, at, 'project', 'dbt_project_execution_pending', 'Project configuration, hooks, variables, packages and adapter dispatch are inert; no dbt process is started.')
   continue
  }
  if (root.semantic_models !== undefined || root.metrics !== undefined) semantic.push({path: file.path, content: JSON.stringify(Object.fromEntries(Object.entries(root).filter(([key]) => ['version','semantic_models','metrics'].includes(key))))})
  unknownKeys(p, at, file.path, root, ['version','semantic_models','metrics','models','sources'])
  if (manifest) continue
  for (const model of objects(p, at, 'models', root.models)) {
   const name = text(model.name)
   if (!name) { issue(p, at, 'model', 'name_required', 'Schema model declarations need a name.'); continue }
   const existing = resources.find(r => r.id === `model.${name}`)
   if (existing) existing.definition = {...existing.definition, schema: model}
   else add(file, `model.${name}`, name, 'model', {schema: model}, [])
   // Retain generic tests at both model and column scope, without running them.
   const scopes = [{name, value: model}, ...objects(p, at, `${name}.columns`, model.columns).map(c => ({name: `${name}.${c.name}`, value: c}))]
   for (const scope of scopes) for (const key of ['tests','data_tests']) {
    const tests = scope.value[key]
    if (tests === undefined) continue
    if (!Array.isArray(tests)) { issue(p, at, scope.name, 'invalid_dbt_tests', 'Tests must be a list.'); continue }
    tests.forEach((test, index) => add(file, `test.${scope.name}.${key}.${index}`, scope.name, 'test', {test}, [`model.${name}`]))
   }
  }
  for (const source of objects(p, at, 'sources', root.sources)) {
   for (const table of objects(p, at, 'source.tables', source.tables)) {
    if (!text(source.name) || !text(table.name)) { issue(p, at, 'source', 'name_required', 'Source tables need both source and table names.'); continue }
    add(file, `source.${source.name}.${table.name}`, String(table.name), 'source', {...table, source}, [])
   }
  }
 }
 readSemanticYAML(p, semantic)
 for (const resource of resources) {
  for (const dependency of resource.dependencies) if (!resources.some(r => r.id === dependency)) issue(p, resource, resource.id, 'missing_dbt_dependency', `Include dependency ${dependency}; no remote project or source is fetched.`)
  if (resource.kind === 'model' && !p.tables.some(t => t.name === resource.name)) {
   p.tables.push({...resource, sourceTable: null, dimensions: [], measures: []})
   p.explores.push({...resource, table: resource.name, joins: []})
  }
  if (resource.kind !== 'project') issue(p, resource, resource.id, 'dbt_resource_execution_pending', `The ${resource.kind} definition and dependency lineage are imported, but execution and source equivalence are unproved. Publication stays blocked.`)
 }
 // Cycles remain diagnostic even in inert projects; never schedule this graph.
 const active = new Set<string>(), complete = new Set<string>()
 const visit = (resource: ProjectResource) => {
  if (active.has(resource.id)) { issue(p, resource, resource.id, 'cyclic_dbt_dependency', 'Resolve the dependency cycle before execution.'); return }
  if (complete.has(resource.id)) return
  active.add(resource.id)
  for (const dependency of resource.dependencies) { const next = resources.find(r => r.id === dependency); if (next) visit(next) }
  active.delete(resource.id); complete.add(resource.id)
 }
 for (const resource of resources) visit(resource)
 if (resources.length) p.resources = resources
}
