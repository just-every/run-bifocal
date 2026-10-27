import { issue, provenance, record, text, yaml } from './common'
import type { Project, ProjectFile, ProjectResource } from './types'

/** Serialization YAML and individual API response objects, never live API calls. */
export function readMetabase(p: Project, files: ProjectFile[]) {
 const resources: ProjectResource[] = []
 for (const file of files) {
  const at = provenance(file, file.content)
  let root: unknown
  if (/\.ya?ml$/i.test(file.path)) root = yaml(p, file)
  else if (/\.json$/i.test(file.path)) { try { root = JSON.parse(file.content) } catch { /* report below */ } }
  else { issue(p, at, file.path, 'unsupported_metabase_file', 'Supply serialization YAML or an individual JSON API export.'); continue }
  if (!record(root)) { issue(p, at, file.path, 'invalid_metabase_object', 'Expected a serialized object mapping.'); continue }
  const metadata = root[['serdes','meta'].join('/')], last = Array.isArray(metadata) ? metadata.at(-1) : null
  const declared = record(last) ? last.model : null
  const kind = record(root.dataset_query) ? 'Card' : declared ?? (Array.isArray(root.fields) ? 'Table' : text(root.engine) && record(root.details) ? 'Database' : root.table_id !== undefined && text(root.base_type) ? 'Field' : Array.isArray(root.dashcards) ? 'Dashboard' : null)
  if (!['Card','Table','Field','Database','Collection','Dashboard'].includes(String(kind))) { issue(p, at, file.path, 'unsupported_metabase_object', 'Include the native object kind or its serialization metadata.'); continue }
  const identity = root.entity_id ?? root.id ?? (record(last) ? last.id : null), name = text(root.name)
  if (!['string','number'].includes(typeof identity) || !name) { issue(p, at, file.path, 'metabase_identity_required', 'Preserve the original object identity and name.'); continue }
  const id = `${kind}.${identity}`, dependencies: string[] = []
  if (root.collection_id !== undefined && root.collection_id !== null) dependencies.push(`Collection.${root.collection_id}`)
  if (kind === 'Card') {
   const query = root.dataset_query
   if (!record(query)) { issue(p, at, id, 'metabase_query_required', 'Include the complete dataset query.'); continue }
   if (query.database !== undefined) dependencies.push(`Database.${query.database}`)
   const walk = (value: unknown, depth = 0): void => {
    if (depth > 64) { issue(p, at, id, 'metabase_query_depth', 'Query nesting exceeds 64 levels.'); return }
    if (Array.isArray(value)) { for (const entry of value) walk(entry, depth + 1); return }
    if (!record(value)) return
    for (const [key, entry] of Object.entries(value)) {
     if (key === 'source-table') {
      if (typeof entry === 'string' && /^card__\d+$/.test(entry)) dependencies.push(`Card.${entry.slice(6)}`)
      else if (typeof entry === 'string' || typeof entry === 'number') dependencies.push(`Table.${entry}`)
      else issue(p, at, id, 'unsupported_metabase_source', 'Resolve this source table reference explicitly.')
     }
     walk(entry, depth + 1)
    }
   }
   walk(query)
   p.tables.push({...at, name, sourceTable: null, dimensions: [], measures: []})
   p.explores.push({...at, name, table: name, joins: []})
  }
  if (kind === 'Table' && root.db_id !== undefined) dependencies.push(`Database.${root.db_id}`)
  if (kind === 'Field' && root.table_id !== undefined) dependencies.push(`Table.${root.table_id}`)
  if (resources.some(r => r.id === id)) issue(p, at, id, 'duplicate_metabase_object', 'Resolve duplicate source identities before rebuilding the model.')
  resources.push({...provenance(file, root), id, name, kind: `metabase-${String(kind).toLowerCase()}`, definition: root, dependencies: [...new Set(dependencies)]})
  issue(p, at, id, 'metabase_execution_pending', 'The source definition is retained. MBQL, native SQL, permissions and visualization semantics require explicit translation; no database is contacted and no expression runs.')
 }
 for (const resource of resources) for (const dependency of resource.dependencies) if (!resources.some(r => r.id === dependency)) issue(p, resource, resource.id, 'missing_metabase_dependency', `Include ${dependency}; missing source objects are not fetched or treated as translated.`)
 p.resources = resources
}
