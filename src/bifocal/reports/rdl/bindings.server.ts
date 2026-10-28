import type { Bindings } from '../../../auth.server'
import { readQuery, sourceMatch } from '../../data/snapshots/store'
import type { InputRow, Schema } from '../../calculations/core'
import { fail } from '../../query/types'
import { exactKeys } from '../../models/validation/transport'
import type { RdlProject } from './parse'
import type { RdlTable } from './execution'
import { children, child, text } from './tree'

type Owner = Parameters<typeof readQuery>[1]
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const mapping = (v: unknown): v is Record<string, string> => object(v) && Object.keys(v).length <= 100 && Object.values(v).every(x => typeof x === 'string' && x.length <= 160)

/** Bind only an explicitly reviewed, immutable, owner-scoped native answer.
 * Source query text stays inert. Parameter mappings can only narrow rows. */
export async function bindRdlQueries(env: Bindings, owner: Owner, ownerId: string, project: RdlProject, input: unknown) {
 if (!Array.isArray(input) || input.length > 32) fail('rdl_query_bindings_required', 400)
 const tables: Record<string, RdlTable> = Object.create(null), guards = [], provenance = []
 const expected = project.definition.reports.flatMap(report => children(child(report.tree, 'DataSets'), 'DataSet').map(dataset => ({file: report.file, dataset})))
 if (input.length !== expected.length) fail('rdl_complete_dataset_bindings_required')
 for (const raw of input) {
  if (!object(raw)) fail('rdl_query_binding_required', 400)
  exactKeys(raw, ['file', 'dataset', 'queryId', 'digest', 'fields', 'parameterFields'])
  if (typeof raw.file !== 'string' || typeof raw.dataset !== 'string' || typeof raw.queryId !== 'string' || !/^[a-f0-9-]{36}$/.test(raw.queryId) || typeof raw.digest !== 'string' || !mapping(raw.fields) || !mapping(raw.parameterFields)) fail('rdl_query_binding_required', 400)
  const fieldMapping = raw.fields, parameterMapping = raw.parameterFields
  const definition = expected.find(item => item.file === raw.file && item.dataset.attributes.Name === raw.dataset)?.dataset
  const key = raw.file + '\n' + raw.dataset
  if (!definition || Object.hasOwn(tables, key)) fail('rdl_unique_dataset_binding_required')
  const fields = children(child(definition, 'Fields'), 'Field'), names = fields.map(field => field.attributes.Name)
  if (new Set(names).size !== names.length || Object.keys(fieldMapping).length !== names.length || names.some(name => !Object.hasOwn(fieldMapping, name))) fail('rdl_complete_field_mapping_required')
  const {snapshot, sources, guard} = await readQuery(env, owner, ownerId, raw.queryId)
  if (snapshot.digest !== raw.digest) fail('rdl_reviewed_query_changed', 409)
  if (snapshot.context.securityScope.kind !== 'installation-owner') fail('rdl_owner_scoped_query_required', 403)
  if (snapshot.answer.rows.length > 2000) fail('rdl_interactive_row_limit', 413)
  const dimensions = snapshot.definition.groupBy, measures = snapshot.definition.measures.map(measure => measure.id)
  const available = [...dimensions, ...measures]
  if (new Set(available).size !== available.length || Object.values(fieldMapping).some(name => !available.includes(name))) fail('rdl_mapped_query_column_unavailable')
  const schema: Schema = Object.create(null)
  for (const name of names) {
   const column = fieldMapping[name]
   if (measures.includes(column)) schema[name] = 'number'
   else {
    const type = snapshot.definition.semantic?.dimensions.find(d => d.column === column)?.type ?? sources.flatMap(source => source.table.columns.map(c => ({...c, name: source.id === snapshot.definition.dataset ? c.name : snapshot.definition.joins.find(j => j.dataset === source.id)!.as + '.' + c.name}))).find(c => c.name === column || 'base.' + c.name === column)?.type
    if (!type || !['text', 'number', 'money', 'date', 'boolean'].includes(type)) fail('rdl_mapped_query_type_unavailable')
    schema[name] = type === 'money' ? 'number' : type as Schema[string]
   }
  }
  const rows: InputRow[] = snapshot.answer.rows.map(source => Object.fromEntries(names.map(name => {
   const column = fieldMapping[name], index = dimensions.indexOf(column)
   if (index >= 0) return [name, source.dimensions[index]]
   const value = source.values[column]
   if (value.state === 'null') return [name, null]
   if (value.state !== 'value' || !value.exact) fail('rdl_incomplete_query_refused', 409)
   return [name, {type: 'number' as const, ...value.exact}]
  })))
  const parameterNames = children(child(child(definition, 'Query'), 'QueryParameters'), 'QueryParameter').map(p => p.attributes.Name)
  if (new Set(parameterNames).size !== parameterNames.length || Object.keys(parameterMapping).length !== parameterNames.length || parameterNames.some(name => !Object.hasOwn(parameterMapping, name) || !Object.hasOwn(schema, parameterMapping[name]))) fail('rdl_complete_query_parameter_mapping_required')
  tables[key] = {schema, rows, parameterFields: raw.parameterFields}
  guards.push(guard, ...sources.map(sourceMatch))
  provenance.push({file: raw.file, dataset: raw.dataset, queryId: snapshot.snapshotId, digest: snapshot.digest, fields: raw.fields, parameterFields: raw.parameterFields, sourceWatermarks: snapshot.answer.sourceWatermarks})
 }
 return {tables, guards, provenance}
}
