import { runtimeBindings, type Bindings } from '../../auth.server'
import { rejectedResponse } from '../../base/rejected-response'
import { fileOwner } from '../imports/files/owner.server'
import { calendarRoute } from '../calendars/server'
import { currencyRoute } from '../currency/server'
import { HOLIDAY_RULES } from '../calendars/holidays'
import { ConventionsError, text } from './protocol'
import { companyRoute, viewerTimezoneRoute } from './routes'
import { companyDefaults } from './settings'
import { guarded, sql, type Authority } from './store'
import { temporalRoute } from './temporal.server'
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const owned = /^\/api\/operator\/(?:company|viewer-timezone|calendars|rates|currency|time|schedules|schedule-definitions|conventions)(?:\/|$)/
/** Mount before the app router. Every request uses Base's current owner and
 * same-origin check, then rechecks authority inside the D1 read/write batch. */
export async function conventionsResponse(request: Request, original: Bindings): Promise<Response | null> {
 const url = new URL(request.url), path = url.pathname
 if (!owned.test(path)) return null
 const env = runtimeBindings(original), owner = await fileOwner(request, env)
 if (!owner) return rejectedResponse(request, json({ error: 'owner_required', reason: 'Sign in as the current installation owner and use the same app origin.' }, 401))
 try {
  let result: unknown
  if (path === '/api/operator/company') result = await companyRoute(request, env, owner)
  else if (path === '/api/operator/viewer-timezone') result = await viewerTimezoneRoute(request, env, owner)
  else if (path === '/api/operator/calendars' || path.startsWith('/api/operator/calendars/')) result = await calendarRoute(request, env, owner, path === '/api/operator/calendars' ? [] : path.slice('/api/operator/calendars/'.length).split('/'))
  else if (path === '/api/operator/rates' || path.startsWith('/api/operator/rates/') || path === '/api/operator/currency/convert') result = await currencyRoute(request, env, owner, path)
  else if (path === '/api/operator/schedules' || path.startsWith('/api/operator/schedules/') || path.startsWith('/api/operator/time/') || path.startsWith('/api/operator/schedule-definitions/')) result = await temporalRoute(request, env, owner, path)
  else if (path === '/api/operator/conventions' && request.method === 'GET') {
   await guarded(env, owner, [])
   result = { defaults: companyDefaults, holidayRules: HOLIDAY_RULES, scope: 'owner-only native company, calendar, civil-time and exact currency calculations',
    schedules: 'versioned one-time definitions and DST resolution; dispatch unavailable', rateSources: 'named owner-imported immutable versions; no live provider feed',
    unavailable: ['analytical reports', 'background dispatch', 'licensed US map boundaries', 'complete accessibility conformance', 'non-owner viewer preferences'] }
  } else if (path === '/api/operator/conventions/audit' && request.method === 'GET') result = await auditPage(env, owner, url)
  else throw new ConventionsError('not_found', 404)
  return json(result, request.method === 'POST' && ['/api/operator/calendars', '/api/operator/rates', '/api/operator/schedules'].includes(path) ? 201 : 200)
 } catch (error) {
  if (error instanceof ConventionsError) return rejectedResponse(request, json({ error: error.code, ...(error.details === undefined ? {} : { details: error.details }) }, error.status))
  if (!(await fileOwner(request, env))) return rejectedResponse(request, json({ error: 'owner_required' }, 401))
  return rejectedResponse(request, json({ error: 'conventions_conflict', reason: 'The current revision or owner authority changed, or the conventions schema is unavailable. Read the current record, verify migrations and review before saving again.' }, 409))
 }
}
async function auditPage(env: Bindings, owner: Authority, url: URL) {
 const before = url.searchParams.get('before'), id = url.searchParams.get('id')
 if ((before === null) !== (id === null)) throw new ConventionsError('audit_cursor_required', 400)
 if (before !== null) { text(before, 'before', 40); text(id, 'id', 40) }
 const [rows] = await guarded<{ id: string; actor: string; kind: string; record_id: string; revision: string; created_at: string }>(env, owner, [sql(`SELECT id,actor,kind,record_id,revision,created_at FROM bf_conventions_audit ${before === null ? '' : 'WHERE created_at<? OR (created_at=? AND id<?)'} ORDER BY created_at DESC,id DESC LIMIT 101`, ...(before === null ? [] : [before, before, id]))])
 const page = rows.slice(0, 100), last = page.at(-1)
 return { entries: page.map(row => ({ id: row.id, actor: row.actor, kind: row.kind, recordId: row.record_id, revision: row.revision, createdAt: row.created_at })), next: rows.length > 100 && last ? { before: last.created_at, id: last.id } : null }
}
