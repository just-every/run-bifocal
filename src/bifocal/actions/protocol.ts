import { exact, object, text } from '../metrics/transport'
import { fail } from '../query/types'
import { boundedText } from '../sources/analytics/protocol'

export const scopes = {pegboard: 'task_create', orbit: 'records:write', happytohelp: 'conversations:create', crank: 'execution'} as const
export type Provider = keyof typeof scopes
export function provider(value: unknown): Provider {
 if (typeof value !== 'string' || !Object.hasOwn(scopes, value)) fail('unsupported_action_provider', 400)
 return value as Provider
}
export function reference(value: unknown): string {
 const ref = text(value, 120)
 if (!/^[A-Za-z0-9_.-]+$/.test(ref)) fail('invalid_action_reference', 400)
 return ref
}
export function fields(value: unknown, name: Provider): string[] {
 if (!Array.isArray(value) || !value.length || value.length > 20 || value.some(v => typeof v !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(v)) || new Set(value).size !== value.length) fail('permitted_fields_required', 400)
 const allowed = {pegboard: ['title','description'], orbit: ['title','stage_id'], happytohelp: ['requester','subject','body'], crank: null}[name]
 if (allowed && value.some(v => !allowed.includes(v))) fail('unsupported_action_field', 400)
 return [...value].sort()
}
type Grant = {provider: Provider; origin: string; target: string; workflow_id: string | null; fields_json: string}
export function command(grant: Grant, payload: unknown, requestRef: string, revision: unknown) {
 if (!object(payload)) fail('action_payload_required', 400)
 exact(payload, JSON.parse(grant.fields_json))
 if (!Object.keys(payload).length) fail('action_payload_required', 400)
 let path: string, body: unknown
 const headers: Record<string,string> = {'content-type': 'application/json', accept: 'application/json'}
 if (grant.provider === 'pegboard') {
  path = '/api/v1/public/tasks'
  body = {projectId: grant.target, title: text(payload.title, 500), ...(payload.description === undefined ? {} : {description: text(payload.description, 4000)}), kind: 'task', intent: requestRef}
 } else if (grant.provider === 'orbit') {
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) fail('provider_revision_required', 400)
  const patch = Object.fromEntries(Object.entries(payload).map(([key,value]) => [key, text(value, key === 'title' ? 500 : 200)]))
  path = '/mcp'; headers['mcp-protocol-version'] = '2025-11-25'
  body = {jsonrpc: '2.0', id: requestRef, method: 'tools/call', params: {name: 'orbit.records.update', arguments: {kind: 'opportunity', id: grant.target, fields: patch, expected_revision: revision, idempotency_key: requestRef}}}
 } else if (grant.provider === 'happytohelp') {
  if (!object(payload.requester)) fail('requester_required', 400)
  exact(payload.requester, ['external_id'])
  path = '/api/v1/conversations'; headers['idempotency-key'] = requestRef
  body = {requester: {external_id: text(payload.requester.external_id, 200)}, subject: text(payload.subject, 500), body: text(payload.body, 4000), source_ref: {product: grant.target, ref: requestRef}}
 } else {
  // The execution credential binds an immutable workflow publication and tool.
  // Only literal scalar business inputs can travel; no transport override.
  for (const value of Object.values(payload)) if (!['string','number','boolean'].includes(typeof value) || typeof value === 'string' && value.length > 4000 || typeof value === 'number' && !Number.isFinite(value)) fail('literal_action_input_required', 400)
  path = '/api/crank/agent-tasks'; headers['idempotency-key'] = requestRef
  body = {task_id: requestRef, actions: [{step_id: grant.target, input: payload}]}
 }
 if (grant.provider !== 'orbit' && revision !== undefined) fail('unsupported_provider_revision', 400)
 return {url: grant.origin + path, headers, body}
}
export type Outcome = {state: 'acknowledged' | 'rejected' | 'unresolved'; outcome: string; sourceLink: string | null}
const unresolved = (): Outcome => ({state: 'unresolved', outcome: 'Provider outcome unresolved; inspect the provider. No automatic retry.', sourceLink: null})
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(v)
/** Only the cited provider HTTPS edge is external. No retries, redirects,
 * ambient cookies, arbitrary headers, provider text or secrets are retained. */
export async function dispatch(grant: Grant, wire: ReturnType<typeof command>, bearer: string): Promise<Outcome> {
 const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000)
 try {
  const response = await fetch(wire.url, {method: 'POST', headers: {...wire.headers, authorization: 'Bearer ' + bearer}, body: JSON.stringify(wire.body), redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal})
  if ([401,403].includes(response.status)) { await response.body?.cancel(); return {state: 'rejected', outcome: 'Provider refused the write credential or scope.', sourceLink: null} }
  if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); return unresolved() }
  const raw = await boundedText(response.body, 65536, 'action_response_limit')
  if (raw.includes(bearer)) return unresolved()
  const value: unknown = JSON.parse(raw)
  if (!object(value)) return unresolved()
  if (grant.provider === 'orbit') {
   if (value.jsonrpc !== '2.0' || value.id !== (wire.body as {id: string}).id || !object(value.result)) return unresolved()
   const result = value.result, uri = 'orbit://records/opportunity/' + grant.target
   if (result.resultType !== 'complete' || result.isError !== false || !object(result.structuredContent) || !Array.isArray(result.content) || !result.content.some(item => object(item) && item.type === 'resource_link' && item.uri === uri)) return unresolved()
   return {state: 'acknowledged', outcome: 'Orbit confirmed the reviewed record update.', sourceLink: uri}
  }
  if (grant.provider === 'pegboard' && response.status === 200 && safeId(value.id)) return {state: 'acknowledged', outcome: 'Pegboard confirmed task creation.', sourceLink: grant.origin + '/api/v1/public/tasks/' + value.id}
  if (grant.provider === 'happytohelp' && response.status === 201 && object(value.data) && safeId(value.data.id) && value.data.status_category === 'new' && object(value.data.source_ref) && value.data.source_ref.product === grant.target && value.data.source_ref.ref === wire.headers['idempotency-key']) return {state: 'acknowledged', outcome: 'HappyToHelp confirmed ticket creation.', sourceLink: grant.origin + '/api/v1/conversations/' + value.data.id}
  if (grant.provider === 'crank' && response.status === 201 && safeId(value.id) && value.workflow_id === grant.workflow_id && typeof value.status === 'string' && ['queued','running','waiting','succeeded','business_complete','uncertain','failed','cancelled'].includes(value.status)) return {state: ['succeeded','business_complete'].includes(value.status) ? 'acknowledged' : 'unresolved', outcome: 'Crank reported run state: ' + value.status + '. Inspect the linked run for its separate business outcome.', sourceLink: grant.origin + '/api/crank/agent-tasks/' + value.id}
  return unresolved()
 } catch { return unresolved() } finally { clearTimeout(timeout) }
}
