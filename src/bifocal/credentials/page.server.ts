import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { appDocument, appPolicy, accountSide, escapeHtml as esc } from '../../app/shell'
import { currentAuthority } from '../catalog/authority.server'
import { QueryError } from '../query/types'
import { credentialResponse, type Scope } from './store.server'

/** Native forms keep bearer material out of URLs and browser persistence. */
export async function credentialPage(request: Request, original: Bindings): Promise<Response | null> {
 const url = new URL(request.url), root = '/app/settings/credentials'
 if (url.pathname !== root && !new RegExp('^' + root + '/[a-f0-9-]{36}/(?:review|rotate|revoke)$').test(url.pathname)) return null
 const env = runtimeBindings(original), actor = await currentAuthority(request, env)
 if (!actor || actor.role !== 'owner' || request.headers.has('authorization')) return new Response('Current installation owner required.', {status: 403, headers: {'cache-control': 'no-store'}})
 const viewer = (await operatorAuth(env).getSession(request))!.operator
 const headers = {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin', 'content-security-policy': `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}
 const document = (main: string, status = 200) => new Response(appDocument({title: 'Machine credentials · Bifocal', viewer, place: 'settings', side: accountSide(viewer.role, 'settings'), main: '<h1>Machine credentials</h1>' + main}), {status, headers})
 const api = async (path: string, body?: Record<string, unknown>) => {
  const forwarded = new Headers(request.headers)
  forwarded.set('content-type', 'application' + '/json')
  const response = await credentialResponse(new Request(url.origin + '/api/operator/credentials' + path, {method: body ? 'POST' : 'GET', headers: forwarded, ...body ? {body: JSON.stringify(body)} : {}}), env)
  if (!response) throw new Error('Missing credential route')
  const result = await response.json() as Record<string, unknown>
  if (!response.ok) throw new QueryError(String(result.error ?? 'credential_unavailable'), response.status)
  return result
 }
 const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`
 try {
  if (url.search) throw new QueryError('unsupported_input', 400)
  if (url.pathname !== root) {
   if (request.method !== 'POST') return document('<p>Use the credential list to start a fresh review.</p>', 405)
   const [, id, action] = url.pathname.slice(root.length).split('/'), form = await request.formData()
   if (action === 'review') {
    const review = await api('/' + id + '/rotate/review', {}), scope = review.scope as Scope
    return document(`<p role="status">Review this exact active credential before rotation.</p><section class="panel"><h2>${esc(scope.purpose)}</h2><p>Sponsor: ${esc(viewer.displayName)}. The replacement retains the exact model, view, sources, row restrictions, fields and tools below.</p><p>Lifetime operations consumed: <strong>${review.usedOperations}</strong> of ${scope.maxOperations}. Original expiry: <strong>${esc(scope.expiresAt)}</strong>.</p><p>The old bearer stops immediately. Rotation cannot extend expiry or replenish the allowance. A read or authority change requires a fresh review. This review expires in five minutes.</p><details open><summary>Exact unchanged scope</summary><pre>${esc(JSON.stringify(scope, null, 2))}</pre></details><form method="post" action="${root}/${id}/rotate">${hidden('reviewedAt', String(review.reviewedAt))}${hidden('reviewedDigest', String(review.reviewedDigest))}<label class="checkbox"><input type="checkbox" name="confirmed" value="yes" required>I reviewed this exact scope, consumption and expiry</label><div class="actions"><button type="submit" class="primary">Rotate credential</button><a href="${root}">Cancel</a></div></form></section>`)
   }
   if (action === 'rotate') {
    if (form.get('confirmed') !== 'yes') throw new QueryError('exact_rotation_review_required', 409)
    const replacement = await api('/' + id + '/rotate', {reviewedAt: form.get('reviewedAt'), reviewedDigest: form.get('reviewedDigest')})
    return document(`<p role="status">Credential rotated. The predecessor is permanently retired.</p><section class="panel"><h2>Save the replacement bearer now</h2><p>This response is its only display. Copy it into your client’s credential store. It is not saved in browser storage or included in archives.</p><label>Replacement bearer<input type="password" autocomplete="off" readonly value="${esc(String(replacement.token))}"></label><p>Replacement id: <code>${esc(String(replacement.id))}</code></p><p>Lifetime operations consumed: ${replacement.usedOperations}. Original expiry: ${esc((replacement.scope as Scope).expiresAt)}.</p><a href="${root}">Return to credentials</a></section>`)
   }
   await api('/' + id + '/revoke', {})
   return document(`<p role="status">Credential revoked.</p><a href="${root}">Return to credentials</a>`)
  }
  if (request.method !== 'GET') return document('<p>Method unavailable.</p>', 405)
  const state = await api(''), credentials = state.credentials as {id: string; definition_json: string; used_operations: number; revoked: number; predecessor_id: string | null}[]
  const history = state.history as {credential_id: string; actor_kind: string; action: string; recorded_at: string}[]
  return document(`<p>Rotate an active owner-sponsored read credential after exact review. Each replacement retains the original expiry and remaining lifetime allowance. Issuance and source policy remain available through the owner API.</p><section class="panel"><h2>Credentials</h2>${credentials.length ? credentials.map(row => {
   const scope = JSON.parse(row.definition_json) as Scope, active = !row.revoked && Date.parse(scope.expiresAt) > Date.now()
   return `<article><h3>${esc(scope.purpose)}</h3><p><code>${row.id}</code></p><p>${row.revoked ? 'Permanently retired' : active ? 'Active' : 'Expired'} · ${row.used_operations} of ${scope.maxOperations} lifetime operations · expires ${esc(scope.expiresAt)}</p>${row.predecessor_id ? `<p>Replaces <code>${esc(row.predecessor_id)}</code></p>` : ''}${active ? `<div class="actions"><form method="post" action="${root}/${row.id}/review"><button type="submit">Review rotation</button></form><form method="post" action="${root}/${row.id}/revoke"><button type="submit">Revoke credential</button></form></div>` : ''}</article>`
  }).join('') : '<p>No credentials issued.</p>'}</section><section class="panel"><h2>Attributed history</h2><ul>${history.map(event => `<li>${esc(event.actor_kind)} · ${esc(event.action)} · <code>${esc(event.credential_id)}</code> · ${esc(event.recorded_at)}</li>`).join('')}</ul></section>`)
 } catch (error) {
  return document(`<p role="alert">${esc(error instanceof QueryError ? error.code : 'Credential changed or is unavailable. Start a fresh review.')}</p><p>No replacement bearer is available from this request.</p><a href="${root}">Return to credentials</a>`, error instanceof QueryError ? error.status : 409)
 }
}
