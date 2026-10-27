import type { Bindings } from '../../auth.server'
import { assertion, sql } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Table } from '../imports/files/csv'
import { fail } from '../query/types'
import { text } from '../metrics/transport'
import { cents, decimal, money, parseSchema, parseValues, type InputSchema } from './schema'
import { inputTemplates } from './templates'

export type Definition = { keyColumn: string; regionColumn: string; region: string; observedColumn: string }
export type InputTable = { id: string; owner_id: string; name: string; dataset_id: string; source_revision: string; definition_json: string; schema_version: number; schema_revision: string; schema_json: string }
export type InputRow = { row_key: string; version: number; value_json: string }
export type Values = Record<string, string | boolean>
export const schemaRevision = (version: number, schema: InputSchema) => sha256(canonicalJson([version, schema]))
export const tableGuard = (table: InputTable) => sql('EXISTS(SELECT 1 FROM bf_input_tables WHERE id=? AND owner_id=? AND definition_json=? AND source_revision=? AND schema_version=? AND schema_revision=? AND schema_json=?)', table.id, table.owner_id, table.definition_json, table.source_revision, table.schema_version, table.schema_revision, table.schema_json)
export const rowGuard = (id: string, row: InputRow) => assertion(sql('EXISTS(SELECT 1 FROM bf_input_rows WHERE table_id=? AND row_key=? AND version=? AND value_json=?)', id, row.row_key, row.version, row.value_json))
export async function savedRows(env: Bindings, id: string) {
 return (await env.DB.prepare('SELECT * FROM bf_input_rows WHERE table_id=? ORDER BY row_key').bind(id).all<InputRow>()).results
}
export const rowsGuard = (id: string, rows: InputRow[]) => [assertion(sql('(SELECT count(*) FROM bf_input_rows WHERE table_id=?)=?', id, rows.length)), ...rows.map(row => rowGuard(id, row))]

export function requestedSchema(v: Record<string, unknown>): InputSchema {
 if (v.schema !== undefined && v.schemaJson !== undefined) fail('invalid_input_schema', 400)
 let raw = v.schema
 if (v.schemaJson !== undefined && v.schemaJson !== '') {
  if (typeof v.schemaJson !== 'string') fail('invalid_input_schema', 400)
  try { raw = JSON.parse(v.schemaJson) } catch { fail('invalid_input_schema', 400) }
 }
 if (raw !== undefined) {
  const schema = parseSchema(raw)
  if (v.template !== undefined && v.template !== schema.template) fail('invalid_input_schema', 400)
  return schema
 }
 const template = inputTemplates.find(t => t.id === (v.template ?? 'forecast-adjustment'))
 if (!template) fail('invalid_input_schema', 400)
 return parseSchema(template.schema)
}

export async function observedSource(env: Bindings, dataset: string, revision: string, definition: Definition) {
 const stored = await env.DB.prepare('SELECT revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<{revision: string; value_json: string}>()
 if (!stored || stored.revision !== revision) fail('source_changed_or_removed', 409)
 const table = JSON.parse(stored.value_json) as Table
 const key = table.columns.findIndex(c => c.name === definition.keyColumn), region = table.columns.findIndex(c => c.name === definition.regionColumn), observed = table.columns.findIndex(c => c.name === definition.observedColumn && c.type === 'money')
 if (key < 0 || region < 0 || observed < 0 || table.key !== definition.keyColumn || table.rows.length > 100) fail('bounded_keyed_USD_source_required', 400)
 const rows = table.rows.filter(row => row[region] === definition.region).map(row => ({rowKey: String(row[key]), observed: money(row[observed])}))
 if (!rows.length || new Set(rows.map(row => row.rowKey)).size !== rows.length) fail('nonempty_unique_regional_rows_required', 400)
 return {rows, guard: sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=? AND value_json=?)', dataset, revision, stored.value_json)}
}

export function inputRows(observed: Awaited<ReturnType<typeof observedSource>>, saved: InputRow[], schema: InputSchema) {
 return observed.rows.map(row => {
  const stored = saved.find(s => s.row_key === row.rowKey), values = stored ? parseValues(schema, JSON.parse(stored.value_json)) : null
  const effect = schema.effect, enabled = values && effect && values[effect.activeColumn] === true
  const amount = enabled ? values[effect!.column] as string : null
  const adjusted = amount !== null && effect!.kind !== 'target' ? decimal(cents(row.observed) + cents(amount)) : row.observed
  return {...row, version: stored?.version ?? 0, values, adjusted, ...(effect?.kind === 'target' ? {target: amount, targetVariance: amount === null ? null : decimal(cents(amount) - cents(row.observed))} : {})}
 })
}

export async function histories(env: Bindings, table: InputTable) {
 const historyCount = (await env.DB.prepare('SELECT count(*) AS n FROM bf_input_history WHERE table_id=?').bind(table.id).first<{n: number}>())!.n
 const history = (await env.DB.prepare('SELECT * FROM bf_input_history WHERE table_id=? ORDER BY recorded_at DESC,row_key,version DESC LIMIT 200').bind(table.id).all<{row_key: string; version: number; schema_version: number; actor_id: string; actor_name: string; before_json: string | null; after_json: string; recorded_at: string}>()).results.map(h => ({rowKey: h.row_key, version: h.version, schemaVersion: h.schema_version, actorId: h.actor_id, actorName: h.actor_name, before: h.before_json ? JSON.parse(h.before_json) : null, after: JSON.parse(h.after_json), recordedAt: h.recorded_at}))
 const schemaHistory = (await env.DB.prepare('SELECT * FROM bf_input_schemas WHERE table_id=? ORDER BY version').bind(table.id).all<{version: number; revision: string; definition_json: string; actor_id: string; actor_name: string; recorded_at: string}>()).results.map(h => ({version: h.version, revision: h.revision, schema: parseSchema(JSON.parse(h.definition_json)), actorId: h.actor_id, actorName: h.actor_name, recordedAt: h.recorded_at}))
 return {historyCount, history, schemaHistory}
}

export function definitionFrom(v: Record<string, unknown>): Definition {
 return {keyColumn: text(v.keyColumn, 200), regionColumn: text(v.regionColumn, 200), region: text(v.region, 200), observedColumn: text(v.observedColumn, 200)}
}
