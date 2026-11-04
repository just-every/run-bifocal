import { expression, issue, physical, provenance, record, tableName, unknownKeys, yaml } from './common'
import type { ModelTable, Project, ProjectFile, Provenance } from './types'

// Documented Omni YAML, retained as data. A reference may resolve only to a
// physical dimension in this view; no SQL, model layer or inherited code runs.
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value)
const reference = (value: unknown) => typeof value === 'string' ? /^\$\{(?:([a-z][a-z0-9_]*)\.)?([a-z][a-z0-9_]*)\}$/.exec(value.trim()) : null
function column(value: unknown): string | null {
 if (typeof value !== 'string') return null
 const quoted = /^(?:"([A-Za-z_][A-Za-z0-9_$]*)"|`([A-Za-z_][A-Za-z0-9_$]*)`)$/.exec(value.trim())
 return physical(quoted ? quoted[1] ?? quoted[2] : value)
}
function fields(p: Project, at: Provenance, object: string, value: unknown): [string, Record<string, unknown>][] {
 if (value === undefined) return []
 if (!record(value)) { issue(p, at, object, 'omni_mapping_required', 'Supply a YAML mapping of original field identifiers.', value); return [] }
 const result: [string, Record<string, unknown>][] = []
 for (const [id, field] of Object.entries(value)) {
  if (!identifier(id) || !record(field)) issue(p, at, object + '.' + id, 'omni_field_required', 'Use an original Omni field identifier and a field mapping.', field)
  else result.push([id, field])
 }
 return result
}
function dependencies(value: unknown): string[] {
 const found = new Set<string>()
 const visit = (item: unknown, key = '') => {
  if (typeof item === 'string') {
   for (const match of item.matchAll(/\$\{([^}]+)\}/g)) found.add(match[1])
   if (['base_view','extends','required_access_grants'].includes(key)) found.add(item)
  } else if (Array.isArray(item)) item.forEach(v => visit(v, key))
  else if (record(item)) for (const [k, v] of Object.entries(item)) {
   if (['joins','relationships'].includes(k) && record(v)) Object.keys(v).forEach(id => found.add(id))
   visit(v, k)
  }
 }
 visit(value)
 return [...found].sort()
}
export function readOmni(p: Project, files: ProjectFile[]) {
 p.resources = []
 const inventory = (file: ProjectFile, id: string, kind: string, definition: Record<string, unknown>) => {
  p.resources!.push({...provenance(file, definition), id, name: id, kind, dependencies: dependencies(definition), definition})
 }
 for (const file of files) {
  const at = provenance(file, file.content)
  const match = /(?:^|\/)([a-z][a-z0-9_]*)\.(view|topic)(?:\.ya?ml)?$/.exec(file.path)
  if (!match) { issue(p, at, file.path, 'unsupported_omni_file', 'Supply original .view or .topic YAML files. Model layers, relationships, workbooks and other files remain unresolved dependencies.'); continue }
  const root = yaml(p, file); if (!root) continue
  const id = root.name ?? match[1], kind = match[2]
  inventory(file, kind + '.' + String(id), kind, root)
  if (!identifier(id)) { issue(p, at, file.path, 'omni_identifier_required', 'Supply an original Omni identifier.'); continue }
  if (kind === 'topic') {
   unknownKeys(p, at, 'topic.' + id, root, ['name','base_view','label','description'])
   if (!identifier(root.base_view)) { issue(p, at, 'topic.' + id, 'omni_base_view_required', 'Include the exact base_view and its original view file.', root.base_view); continue }
   p.explores.push({...at, name: id, table: root.base_view, joins: []})
   continue
  }
  unknownKeys(p, at, 'view.' + id, root, ['name','table_name','schema','catalog','label','description','dimensions','measures'])
  const parts = [root.catalog, root.schema, root.table_name ?? id].filter(v => v !== undefined)
  const sourceTable = parts.every(v => typeof v === 'string' && column(v)) ? tableName(parts.map(v => column(v)).join('.')) : null
  if (!sourceTable) issue(p, at, 'view.' + id, 'omni_physical_table_required', 'Review a physical table, schema and catalog. SQL-backed views are not executable.', parts)
  const table: ModelTable = {...at, name: id, sourceTable, dimensions: [], measures: []}
  p.tables.push(table)
  const dimensions = fields(p, at, id + '.dimensions', root.dimensions)
  const resolve = (value: unknown): string | null => {
   const ref = reference(value)
   if (!ref) return column(value)
   if (ref[1] && ref[1] !== id) return null
   const field = dimensions.find(([name]) => name === ref[2])
   return field ? column(field[1].sql) : null
  }
  for (const [name, d] of dimensions) {
   const loc = provenance(file, d)
   inventory(file, id + '.' + name, 'dimension', d)
   unknownKeys(p, loc, id + '.dimensions.' + name, d, ['sql','primary_key','label','description'])
   const target = resolve(d.sql)
   if (!target) { issue(p, loc, id + '.dimensions.' + name, 'omni_physical_dimension_required', 'Bind a physical column or a same-view physical dimension. SQL expressions, absent schema definitions and inherited fields require resolution.', d.sql); continue }
   if (d.primary_key !== undefined && typeof d.primary_key !== 'boolean') issue(p, loc, id + '.dimensions.' + name, 'omni_primary_key_required', 'primary_key must be boolean.', d.primary_key)
   table.dimensions.push({...loc, name, column: target, type: 'unknown', sourceType: 'reviewed-physical-column', primaryKey: d.primary_key === true, sourceExpression: expression(d.sql)})
  }
  for (const [name, m] of fields(p, at, id + '.measures', root.measures)) {
   const loc = provenance(file, m)
   inventory(file, id + '.' + name, 'measure', m)
   unknownKeys(p, loc, id + '.measures.' + name, m, ['sql','aggregate_type','label','description'])
   const target = resolve(m.sql), op = m.aggregate_type === 'sum' ? 'sum' : m.aggregate_type === 'count_distinct' ? 'count-distinct' : null
   if (!target || !op) { issue(p, loc, id + '.measures.' + name, 'unsupported_omni_measure', 'Only sum and count_distinct of explicitly defined physical columns translate. Resolve SQL, cross-view references and other aggregates before native preview.', m); continue }
   table.measures.push({...loc, name, op, column: target, ...(op === 'sum' ? {empty: 'null' as const} : {}), sourceExpression: expression(m.sql)})
  }
 }
 if (!p.explores.length) issue(p, {file:'',sourceExpression:''}, 'project', 'omni_topic_required', 'Include an original single-table topic with an explicit base_view; a view alone supplies no query scope.')
}
