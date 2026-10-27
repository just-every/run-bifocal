import { issue, objects, provenance, record, text, unknownKeys, yaml } from './common'
import { readSemanticYAML } from './semantic-yaml'
import type { Project, ProjectFile, ProjectResource } from './types'

/** Definitions remain inert. The separate bounded translator proves literal
 * projections and generic checks against explicitly reviewed native records. */
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
   unknownKeys(p,at,'manifest',value,['metadata','nodes','sources','macros','docs','exposures','metrics','semantic_models','saved_queries','unit_tests','disabled','groups','selectors','functions','parent_map','child_map','group_map'])
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
   for (const group of ['macros','exposures','metrics','semantic_models','saved_queries','unit_tests','disabled','groups','selectors','functions']) {
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
      if (group === 'semantic_models') {
       const metadata = ['unique_id','resource_type','package_name','path','original_file_path','fqn','depends_on','created_at','config','group','meta','node_relation']
       semantic.push({path:manifest.path+'.yaml',content:JSON.stringify({semantic_models:[Object.fromEntries(Object.entries(entry).filter(([key])=>!metadata.includes(key)))]})})
      }
     }
    }
   }
  }
 }
 // Keep resolved manifest resources and uploaded SQL as inert inventory.
 // Literal source references never establish Jinja compilation or equivalence.
 for (const file of [...files].sort((a, b) => Number(/\.sql$/i.test(b.path)) - Number(/\.sql$/i.test(a.path)))) {
  if (file === manifest) continue
  const at = provenance(file, file.content)
  if (/\.sql$/i.test(file.path)) {
   if (manifest && resources.some(r => r.name === file.path.split('/').at(-1)!.replace(/\.sql$/i, '') && (r.definition.raw_code === file.content || r.definition.raw_sql === file.content))) continue
