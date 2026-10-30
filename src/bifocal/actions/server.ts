import { randomUUID } from 'node:crypto'
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { ownerIdentity } from '../data/snapshots/store'
import { fileOwner } from '../imports/files/owner.server'
import { observedSource, savedRows, tableGuard, type Definition, type InputTable } from '../inputs/store.server'
import { exact, ident, input, json, text } from '../metrics/transport'
import { fail, QueryError } from '../query/types'
import { publicOrigin, token } from '../sources/analytics/protocol'
import { rejectedUpload } from '../http/rejected'
import { command, dispatch, fields, provider, reference, scopes, type Provider } from './protocol'

type Grant = {id: string; owner_id: string; owner_version: number; table_id: string; provider: Provider; origin: string; target: string; workflow_id: string | null; fields_json: string; token_hash: string; expires_at: string; revoked_at: string | null}
type Receipt = {id: string; owner_id: string; grant_id: string; table_id: string; request_ref: string; digest: string; state: string; outcome: string | null; source_link: string | null; created_at: string; approved_at: string | null; settled_at: string | null}
const grantGuard = (g: Grant) => sql("EXISTS(SELECT 1 FROM bf_action_grants WHERE id=? AND owner_id=? AND owner_version=? AND token_hash=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))", g.id, g.owner_id, g.owner_version, g.token_hash)
const present = (r: Receipt) => ({id: r.id, requestRef: r.request_ref, digest: r.digest, state: r.state === 'attempting' ? 'unresolved' : r.state, outcome: r.outcome ?? (r.state === 'attempting' ? 'Attempt claimed; outcome unresolved. Do not repeat the external write.' : 'Awaiting exact human approval.'), sourceLink: r.source_link, approvedBy: r.approved_at ? r.owner_id : null, approvedAt: r.approved_at, createdAt: r.created_at, settledAt: r.settled_at})

async function handle(request: Request, original: Bindings): Promise<Response | null> {
 const url = new URL(request.url), match = /^\/api\/operator\/row-actions\/(grants\/review|grants|grants\/([a-zA-Z0-9-]+)\/revoke|review|send|receipts\/([a-zA-Z0-9-]+))$/.exec(url.pathname)
 if (!match) return null
 const env = runtimeBindings(original)
 try {
  const owner = await fileOwner(request, env)
  if (!owner || request.headers.has('Authorization')) fail('owner_required', 401)
  if (url.search) fail('query_parameters_not_supported', 400)
  const ownerId = await ownerIdentity(env, owner), viewer = (await operatorAuth(env).getSession(request))!.operator
  const configured = (name: Provider, origin: string) => {
   let origins: Record<string,unknown> = {}; try { origins = JSON.parse(env.BIFOCAL_ACTION_ORIGINS ?? '{}') } catch { /* fail closed */ }
   if (origins?.[name] !== origin) fail('provider_installation_not_configured', 409)
  }
  const table = async (id: string) => {
   const t = await env.DB.prepare('SELECT * FROM bf_input_tables WHERE id=? AND owner_id=?').bind(id, ownerId).first<InputTable>()
   if (!t) fail('input_table_unavailable', 404)
   const source = await observedSource(env, t.dataset_id, t.source_revision, JSON.parse(t.definition_json) as Definition)
   return {t, source, guards: [assertion(tableGuard(t)), assertion(source.guard)]}
  }
  const activeGrant = async (id: string) => {
   const g = await env.DB.prepare('SELECT * FROM bf_action_grants WHERE id=? AND owner_id=?').bind(id, ownerId).first<Grant>()
   if (!g || g.revoked_at || g.owner_version !== viewer.version || g.expires_at <= new Date().toISOString()) fail('action_grant_unavailable', 403)
   configured(g.provider, g.origin)
   return g
  }
  if (match[3]) {
   if (request.method !== 'GET') fail('method_not_allowed', 405)
   const r = await env.DB.prepare('SELECT * FROM bf_action_receipts WHERE id=? AND owner_id=?').bind(match[3], ownerId).first<Receipt>()
   if (!r) fail('action_receipt_unavailable', 404)
   const g = await activeGrant(r.grant_id), source = await table(g.table_id)
   await transact(env.DB, owner, [assertion(grantGuard(g)), ...source.guards])
   return json(present(r))
  }
  if (request.method !== 'POST') fail('method_not_allowed', 405)
  const v = await input(request)
  if (match[2]) {
   exact(v, ['confirm']); if (v.confirm !== true) fail('explicit_revoke_required', 400)
   const g = await activeGrant(match[2])
   await transact(env.DB, owner, [assertion(grantGuard(g)), sql('UPDATE bf_action_grants SET revoked_at=? WHERE id=?', new Date().toISOString(), g.id)])
   return json({revoked: true})
  }
  if (match[1] === 'grants' || match[1] === 'grants/review') {
   exact(v, ['tableId','provider','origin','target','workflowId','fields','accessToken','expiresAt','scope','reviewedDigest','confirm'])
   const name = provider(v.provider), origin = publicOrigin(v.origin), target = reference(v.target), bearer = token(v.accessToken)
   const workflowId = name === 'crank' ? reference(v.workflowId) : null
   if (name !== 'crank' && v.workflowId !== undefined) fail('unsupported_workflow_binding', 400)
   // Deployment approval is independent of native row input and of this grant.
   configured(name, origin)
   if (v.scope !== scopes[name]) fail('separate_write_scope_required', 403)
   const expiresAt = text(v.expiresAt, 24), now = new Date().toISOString()
   if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt)) || expiresAt <= now || Date.parse(expiresAt) > Date.now() + 86400000) fail('grant_expiry_within_one_day_required', 400)
   const source = await table(ident(v.tableId)), selected = fields(v.fields, name)
   const definition = {tableId: source.t.id, provider: name, origin, target, ...(workflowId ? {workflowId} : {}), fields: selected, scope: scopes[name], expiresAt}
   const digest = sha256(canonicalJson({definition, credential: sha256(bearer), authority: owner.params, table: tableGuard(source.t), source: source.source.guard}))
   if (match[1] === 'grants/review') { await transact(env.DB, owner, source.guards); return json({...definition, digest, notice: 'This separate write grant does not approve any row action. Provider authorization remains required.'}) }
   if (v.confirm !== true || v.reviewedDigest !== digest) fail('exact_grant_approval_required', 409)
   const id = randomUUID()
   await transact(env.DB, owner, [...source.guards, sql('INSERT INTO bf_action_grants(id,owner_id,owner_version,table_id,provider,origin,target,workflow_id,fields_json,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, ownerId, viewer.version, source.t.id, name, origin, target, workflowId, canonicalJson(selected), sha256(bearer), expiresAt, now)])
   return json({id, ...definition}, 201)
  }
  exact(v, ['grantId','rowKey','inputVersion','schemaRevision','payload','providerRevision','requestRef','accessToken','reviewedDigest','confirm'])
  const g = await activeGrant(text(v.grantId, 100)), source = await table(g.table_id), bearer = token(v.accessToken)
  if (sha256(bearer) !== g.token_hash) fail('action_credential_changed', 403)
  const rowKey = text(v.rowKey, 200), rows = await savedRows(env, source.t.id), saved = rows.find(r => r.row_key === rowKey)
  if (!source.source.rows.some(r => r.rowKey === rowKey)) fail('row_rule_denied', 403)
  if (v.schemaRevision !== source.t.schema_revision || v.inputVersion !== (saved?.version ?? 0)) fail('action_source_changed', 409)
  const requestRef = reference(v.requestRef), wire = command(g, v.payload, requestRef, v.providerRevision)
  if (JSON.stringify(wire).includes(bearer)) fail('credential_in_action_payload', 400)
  const guards = [assertion(grantGuard(g)), ...source.guards, assertion(saved ? sql('EXISTS(SELECT 1 FROM bf_input_rows WHERE table_id=? AND row_key=? AND version=? AND value_json=?)', source.t.id, rowKey, saved.version, saved.value_json) : sql('NOT EXISTS(SELECT 1 FROM bf_input_rows WHERE table_id=? AND row_key=?)', source.t.id, rowKey))]
  const digest = sha256(canonicalJson({grantId: g.id, credential: g.token_hash, authority: owner.params, rowKey, inputVersion: v.inputVersion, schemaRevision: v.schemaRevision, source: source.source.guard, wire}))
  let r = await env.DB.prepare('SELECT * FROM bf_action_receipts WHERE owner_id=? AND request_ref=?').bind(ownerId, requestRef).first<Receipt>()
  if (r && r.digest !== digest) fail('action_review_changed', 409)
  if (match[1] === 'review') {
   if (!r) {
    const id = randomUUID(), now = new Date().toISOString()
    await transact(env.DB, owner, [...guards, sql("INSERT INTO bf_action_receipts(id,owner_id,grant_id,table_id,request_ref,digest,state,created_at) VALUES(?,?,?,?,?,?,'review',?)", id, ownerId, g.id, source.t.id, requestRef, digest, now)])
    r = (await env.DB.prepare('SELECT * FROM bf_action_receipts WHERE id=?').bind(id).first<Receipt>())!
   } else await transact(env.DB, owner, guards)
   return json({...present(r), provider: g.provider, scope: scopes[g.provider], destination: wire.url, providerTarget: {target: g.target, ...(g.workflow_id ? {workflowId: g.workflow_id} : {})}, payload: wire.body, source: {dataset: source.t.dataset_id, revision: source.t.source_revision, rowKey, inputVersion: v.inputVersion}, notice: 'Review the exact external destination and payload. Nothing has been sent.'})
  }
  if (!r || v.confirm !== true || v.reviewedDigest !== digest) fail('exact_human_approval_required', 409)
  if (r.state !== 'review') { await transact(env.DB, owner, guards); return json(present(r)) }
  // Exactly one claimant commits current authority, source and grant fences.
  // A crashed or overlapping sender stays unresolved and never blindly retries.
  await transact(env.DB, owner, [...guards, assertion(sql("EXISTS(SELECT 1 FROM bf_action_receipts WHERE id=? AND digest=? AND state='review')", r.id, digest)), sql("UPDATE bf_action_receipts SET state='attempting',approved_at=? WHERE id=?", new Date().toISOString(), r.id)])
  await transact(env.DB, owner, guards)
  const outcome = await dispatch(g, wire, bearer)
  await env.DB.prepare("UPDATE bf_action_receipts SET state=?,outcome=?,source_link=?,settled_at=? WHERE id=? AND state='attempting'").bind(outcome.state, outcome.outcome, outcome.sourceLink, new Date().toISOString(), r.id).run()
  await transact(env.DB, owner, guards)
  r = (await env.DB.prepare('SELECT * FROM bf_action_receipts WHERE id=?').bind(r.id).first<Receipt>())!
  return json(present(r))
 } catch (error) {
  return json({error: error instanceof QueryError ? error.code : 'action_conflict'}, error instanceof QueryError ? error.status : 409)
 }
}
export async function rowActionResponse(request: Request, env: Bindings): Promise<Response | null> { const response = await handle(request, env); return response ? rejectedUpload(request, response) : null }
