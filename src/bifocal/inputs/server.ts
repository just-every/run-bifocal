import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { escapeHtml } from '../../app/shell'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { ownerIdentity } from '../data/snapshots/store'
import { fileOwner } from '../imports/files/owner.server'
import { exact, ident, input, json, result, text } from '../metrics/transport'
import { fail, QueryError } from '../query/types'
import { rejectedUpload } from '../http/rejected'
import { parseSchema, parseValues, validateSchemaChange } from './schema'
import { definitionFrom, histories, inputRows, observedSource, requestedSchema, rowsGuard, savedRows, schemaRevision, tableGuard, type Definition, type InputTable } from './store.server'
import { inputDocument, inputList, reviewMain, tableMain } from './pages'

const creationFields = ['id','name','dataset','sourceRevision','keyColumn','regionColumn','region','observedColumn','template','schema','schemaJson','reviewedDigest']
const isForm = (request: Request) => request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded') ?? false

async function handle(request: Request, original: Bindings): Promise<Response | null> {
 const url = new URL(request.url), match = /^\/(app|api\/operator)\/inputs(?:\/([a-z][a-z0-9-]{0,63}))?(?:\/(rows|schema)(?:\/(review))?)?$/.exec(url.pathname)
 if (!match) return null
 const page = match[1] === 'app', env = runtimeBindings(original), owner = await fileOwner(request, env)
 if (!owner || request.headers.has('Authorization')) return json({error: 'owner_required'}, 401)
 const ownerId = await ownerIdentity(env, owner), viewer = (await operatorAuth(env).getSession(request))!.operator
 try {
  if (url.search) fail('query_parameters_not_supported', 400)
  const id = match[2], action = match[3], reviewing = match[4] === 'review'
  if (request.method === 'POST' && (!id || id === 'review' && !action)) {
   const v = await input(request); exact(v, creationFields)
   const key = ident(v.id), dataset = ident(v.dataset), revision = text(v.sourceRevision, 100), name = text(v.name, 120)
   if (key === 'review') fail('reserved_input_id', 400)
   const definition = definitionFrom(v), schema = requestedSchema(v), observed = await observedSource(env, dataset, revision, definition)
   const schemaVersion = 1, revisionId = schemaRevision(schemaVersion, schema)
   const bindings = {id: key, name, dataset, sourceRevision: revision, ...definition}
   const digest = sha256(canonicalJson({bindings, schema, authority: owner.params, source: observed.guard.params}))
   if (id === 'review') {
    await transact(env.DB, owner, [assertion(observed.guard)])
    const review = {digest, schema, schemaVersion, schemaRevision: revisionId, ...bindings}
    return isForm(request) ? inputDocument('Review input table', viewer, reviewMain('/api/operator/inputs', {...bindings, schemaJson: canonicalJson(schema)}, digest, schema, schemaVersion, bindings)) : json(review)
   }
   if (v.reviewedDigest !== digest) fail('input_review_changed', 409)
   const now = new Date().toISOString()
   await transact(env.DB, owner, [assertion(observed.guard), sql('INSERT INTO bf_input_tables(id,owner_id,name,dataset_id,source_revision,definition_json,created_at,schema_version,schema_revision,schema_json) VALUES(?,?,?,?,?,?,?,?,?,?)', key, ownerId, name, dataset, revision, canonicalJson(definition), now, schemaVersion, revisionId, canonicalJson(schema)), sql('INSERT INTO bf_input_schemas(table_id,version,revision,definition_json,actor_id,actor_name,recorded_at) VALUES(?,?,?,?,?,?,?)', key, schemaVersion, revisionId, canonicalJson(schema), viewer.id, viewer.displayName, now)])
   return result(request, {id: key, columns: schema.columns, schema, schemaVersion, schemaRevision: revisionId, definition, source: {dataset, revision}}, '/app/inputs/' + key)
  }
  if (!id) {
   if (request.method !== 'GET' || action) fail('method_not_allowed', 405)
   const tables = (await env.DB.prepare('SELECT id,name FROM bf_input_tables WHERE owner_id=? ORDER BY id LIMIT 100').bind(ownerId).all<{id: string; name: string}>()).results
   await transact(env.DB, owner, [])
   return page ? inputDocument('Input tables', viewer, inputList(tables)) : json({tables})
  }
  const table = await env.DB.prepare('SELECT * FROM bf_input_tables WHERE id=? AND owner_id=?').bind(id, ownerId).first<InputTable>()
  if (!table) fail('input_table_not_found', 404)
  const definition = JSON.parse(table.definition_json) as Definition, schema = parseSchema(JSON.parse(table.schema_json))
  const observed = await observedSource(env, table.dataset_id, table.source_revision, definition), guard = tableGuard(table)
  if (request.method === 'POST' && action === 'schema') {
   const v = await input(request); exact(v, ['previousSchemaRevision','schema','schemaJson','reviewedDigest'])
   if (v.previousSchemaRevision !== table.schema_revision) fail('schema_changed', 409)
   const next = requestedSchema(v), saved = await savedRows(env, id)
   validateSchemaChange(schema, next)
   for (const row of saved) parseValues(next, JSON.parse(row.value_json))
   const schemaVersion = table.schema_version + 1, revisionId = schemaRevision(schemaVersion, next)
   const bindings = {dataset: table.dataset_id, sourceRevision: table.source_revision, ...definition}
   const digest = sha256(canonicalJson({id, previousSchemaRevision: table.schema_revision, schema: next, authority: owner.params, source: observed.guard.params, rows: saved}))
   const guards = [assertion(guard), assertion(observed.guard), ...rowsGuard(id, saved)]
   if (reviewing) {
    await transact(env.DB, owner, guards)
    return isForm(request) ? inputDocument('Review column definition', viewer, reviewMain('/api/operator/inputs/' + id + '/schema', {previousSchemaRevision: table.schema_revision, schemaJson: canonicalJson(next)}, digest, next, schemaVersion, bindings, true)) : json({digest, schema: next, schemaVersion, schemaRevision: revisionId})
   }
   if (v.reviewedDigest !== digest) fail('input_review_changed', 409)
   const now = new Date().toISOString()
   await transact(env.DB, owner, [...guards, sql('UPDATE bf_input_tables SET schema_version=?,schema_revision=?,schema_json=? WHERE id=?', schemaVersion, revisionId, canonicalJson(next), id), sql('INSERT INTO bf_input_schemas(table_id,version,revision,definition_json,actor_id,actor_name,recorded_at) VALUES(?,?,?,?,?,?,?)', id, schemaVersion, revisionId, canonicalJson(next), viewer.id, viewer.displayName, now)])
   return result(request, {schema: next, schemaVersion, schemaRevision: revisionId}, '/app/inputs/' + id, 200)
  }
  if (request.method === 'POST' && action === 'rows' && !reviewing) {
   const v = await input(request), rowKey = text(v.rowKey, 200)
   if (typeof v.schemaRevision !== 'string' || !v.schemaRevision) fail('schema_revision_required', 400)
   if (v.schemaRevision !== table.schema_revision) fail('schema_changed', 409)
   exact(v, ['rowKey','previousVersion','schemaRevision', ...schema.columns.map(c => c.name)])
   const {rowKey: unusedKey, previousVersion: unusedVersion, schemaRevision: unusedSchema, ...rawValues} = v
   const after = parseValues(schema, rawValues, isForm(request))
   if (!observed.rows.some(row => row.rowKey === rowKey)) fail('row_rule_denied', 403)
   const before = (await savedRows(env, id)).find(row => row.row_key === rowKey)
   if (!/^(?:0|[1-9]\d{0,8})$/.test(String(v.previousVersion)) || Number(v.previousVersion) !== (before?.version ?? 0)) fail('input_conflict', 409)
   const version = (before?.version ?? 0) + 1, value = canonicalJson(after), now = new Date().toISOString()
   await transact(env.DB, owner, [assertion(guard), assertion(observed.guard), assertion(before ? sql('EXISTS(SELECT 1 FROM bf_input_rows WHERE table_id=? AND row_key=? AND version=? AND value_json=?)', id, rowKey, before.version, before.value_json) : sql('NOT EXISTS(SELECT 1 FROM bf_input_rows WHERE table_id=? AND row_key=?)', id, rowKey)), sql('INSERT INTO bf_input_rows(table_id,row_key,version,value_json) VALUES(?,?,?,?) ON CONFLICT(table_id,row_key) DO UPDATE SET version=excluded.version,value_json=excluded.value_json', id, rowKey, version, value), sql('INSERT INTO bf_input_history(table_id,row_key,version,actor_id,actor_name,before_json,after_json,recorded_at,schema_version) VALUES(?,?,?,?,?,?,?,?,?)', id, rowKey, version, viewer.id, viewer.displayName, before?.value_json ?? null, value, now, table.schema_version)])
   return result(request, {rowKey, version, values: after}, '/app/inputs/' + id, 200)
  }
  if (request.method !== 'GET' || action) fail('method_not_allowed', 405)
  const saved = await savedRows(env, id), rows = inputRows(observed, saved, schema), history = await histories(env, table)
  await transact(env.DB, owner, [assertion(guard), assertion(observed.guard), assertion(sql('(SELECT count(*) FROM bf_input_history WHERE table_id=?)=?', id, history.historyCount)), assertion(sql('(SELECT count(*) FROM bf_input_schemas WHERE table_id=?)=?', id, history.schemaHistory.length)), ...rowsGuard(id, saved)])
  const value = {id, name: table.name, columns: schema.columns, schema, schemaVersion: table.schema_version, schemaRevision: table.schema_revision, definition, source: {dataset: table.dataset_id, revision: table.source_revision}, rows, ...history}
  return page ? inputDocument(table.name, viewer, tableMain(table, schema, definition, rows, history.history, history.historyCount, history.schemaHistory)) : json(value)
 } catch (error) {
  const failure = error instanceof QueryError ? error : new QueryError('input_conflict', 409)
  return page || isForm(request) ? inputDocument('Input unavailable', viewer, `<p role="alert">${escapeHtml(failure.code)}</p><a href="/app/inputs">Return to input tables</a>`, failure.status) : json({error: failure.code}, failure.status)
 }
}
export async function inputTableResponse(request: Request, env: Bindings): Promise<Response | null> { const response = await handle(request, env); return response ? rejectedUpload(request, response) : null }
