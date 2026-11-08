import type { Bindings } from '../../auth.server'
import type { AuditRow } from '../../modules/agent-door/audit'
import { classIds } from '../../modules/agent-door/policy/catalogue'
import { currentAuthority, type Authority } from '../catalog/authority.server'
import { bifocalAgentDoor } from './index.server'

export const activityRoot = '/app/settings/agent-activity'
export const activityLimits = { sourcePages: 50, sourcePageSize: 200, records: 1000, bytes: 2 * 1024 * 1024, pageSize: 50 } as const
export class ActivityError extends Error {
 constructor(public code: string, public status: number) { super(code) }
}
export type ActivityFilters = { from: string; through: string; agent: string; class: string; page: number }

export function activityFilters(url: URL): ActivityFilters {
 const allowed = ['from', 'through', 'agent', 'class', 'page']
 for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new ActivityError('invalid_filters', 400)
 const today = new Date(), first = new Date(today)
 first.setUTCDate(first.getUTCDate() - 6)
 const from = url.searchParams.get('from') ?? first.toISOString().slice(0, 10), through = url.searchParams.get('through') ?? today.toISOString().slice(0, 10)
 const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
 const agent = url.searchParams.get('agent') ?? '', cls = url.searchParams.get('class') ?? '', page = url.searchParams.get('page') ?? '1'
 if (!date(from) || !date(through) || from > through || agent.length > 200 || /[\x00-\x1f\x7f]/.test(agent) || cls && !classIds.includes(cls as typeof classIds[number]) || !/^[1-9]\d{0,5}$/.test(page)) throw new ActivityError('invalid_filters', 400)
 return { from, through, agent, class: cls, page: Number(page) }
}

export async function activityOwner(request: Request, env: Bindings): Promise<Authority> {
 if (request.headers.has('authorization')) throw new ActivityError('owner_session_required', 403)
 const actor = await currentAuthority(request, env)
 if (!actor || actor.role !== 'owner') throw new ActivityError('owner_session_required', 403)
 return actor
}

export async function recheckActivityOwner(env: Bindings, actor: Authority) {
 if (!await env.DB.prepare(`SELECT 1 WHERE (${actor.sql})`).bind(...actor.params ?? []).first()) throw new ActivityError('owner_session_required', 403)
}

/** Traverse the existing human audit API. A filtered empty page is not its end.
 * No direct audit-table reader, output capture or second audit store is added. */
export async function readActivity(request: Request, env: Bindings, actor: Authority, filters: ActivityFilters) {
 const records: AuditRow[] = [], ids = new Set<string>(), door = bifocalAgentDoor(env)
 const lower = Date.parse(filters.from), upper = Date.parse(filters.through) + 86400000
 let cursor: string | null = null, differsFromPolicy = 0
 for (let page = 0; ; page++) {
  const params = new URLSearchParams()
  if (cursor !== null) params.set('after', cursor)
  if (filters.agent) params.set('agent', filters.agent)
  if (filters.class) params.set('class', filters.class)
  const response = await door.handle(new Request(env.AUTH_ORIGIN + '/agents/api/audit?' + params, { headers: { cookie: request.headers.get('cookie') ?? '', host: new URL(env.AUTH_ORIGIN).host } }))
  if (!response?.ok) throw new ActivityError('audit_unavailable', 503)
  const result = await response.json() as { rows: AuditRow[]; cursor: string | null; differs_from_policy: number }
  if (!Array.isArray(result.rows) || result.rows.length > activityLimits.sourcePageSize || !Number.isSafeInteger(result.differs_from_policy) || result.differs_from_policy < 0) throw new ActivityError('audit_unavailable', 503)
  const next = result.cursor
  if (next !== null && (typeof next !== 'string' || !/^[1-9]\d*$/.test(next))) throw new ActivityError('audit_unavailable', 503)
  if (next !== cursor && next !== null && cursor !== null && BigInt(next) <= BigInt(cursor)) throw new ActivityError('audit_unavailable', 503)
  if (page === activityLimits.sourcePages && next !== cursor && next !== null) throw new ActivityError('activity_capacity', 413)
  differsFromPolicy += result.differs_from_policy
  for (const row of result.rows) {
   const at = Date.parse(row.at)
   if (!Number.isFinite(at)) throw new ActivityError('audit_unavailable', 503)
   if (at < lower || at >= upper || filters.agent && row.agent.id !== filters.agent || filters.class && !row.classes.some(item => item.class === filters.class)) continue
   if (ids.has(row.id)) throw new ActivityError('audit_unavailable', 503)
   ids.add(row.id); records.push(row)
   if (records.length > activityLimits.records) throw new ActivityError('activity_capacity', 413)
  }
  if (next === null || next === cursor) break
  cursor = next
 }
 const classes: Record<string, number> = Object.create(null), decisions: Record<string, number> = Object.create(null)
 for (const row of records) {
  decisions[row.decision] = (decisions[row.decision] ?? 0) + 1
  for (const cls of new Set(row.classes.map(item => item.class))) classes[cls] = (classes[cls] ?? 0) + 1
 }
 const data = { complete: true, period: { from: filters.from, through: filters.through, timeZone: 'UTC' }, filters: { agent: filters.agent || null, class: filters.class || null }, count: records.length, counts: { classes, decisions }, differsFromPolicy, recordedThroughSequence: cursor, records }
 const serialized = JSON.stringify(data, null, 2)
 if (new TextEncoder().encode(serialized).byteLength > activityLimits.bytes) throw new ActivityError('activity_capacity', 413)
 // A session withdrawn while pages were being read cannot release the history.
 await recheckActivityOwner(env, actor)
 return { data, serialized }
}
