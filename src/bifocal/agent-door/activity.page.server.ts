import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { appDocument, appPolicy, accountSide, escapeHtml as esc } from '../../app/shell'
import { classIds } from '../../modules/agent-door/policy/catalogue'
import { activityRoot, activityLimits, ActivityError, activityFilters, activityOwner, readActivity, type ActivityFilters } from './activity.server'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}` }
const href = (filters: ActivityFilters, page = 1) => activityRoot + '?' + new URLSearchParams({ from: filters.from, through: filters.through, agent: filters.agent, class: filters.class, page: String(page) })
const bounds = `At most ${activityLimits.records} selected actions, ${activityLimits.sourcePages * activityLimits.sourcePageSize} scanned records and 2 MiB of JSON per request. Narrow the period, agent or class if a limit is reached. Counts and export are available only after the full scan completes.`

export async function activityPage(request: Request, original: Bindings): Promise<Response | null> {
 const url = new URL(request.url), exporting = url.pathname === activityRoot + '/export'
 if (url.pathname !== activityRoot && !exporting) return null
 const env = runtimeBindings(original)
 const refusal = (code: string, status: number) => new Response(JSON.stringify({ code, complete: false }), { status, headers: { ...headers, 'content-type': 'application' + '/json; charset=utf-8' } })
 let actor
 try { actor = await activityOwner(request, env) } catch { return refusal('owner_session_required', 403) }
 if (request.method !== 'GET') return refusal('method_not_allowed', 405)
 const session = await operatorAuth(env).getSession(request)
 if (!session) return refusal('owner_session_required', 403)
 const document = (main: string, status = 200) => new Response(appDocument({ title: 'Agent activity · Bifocal', viewer: session.operator, place: 'settings', side: accountSide(session.operator.role, 'settings'), main: `<h1>Agent activity</h1><p>Browse recorded agent actions as the current owner. Dates include the full selected days in UTC.</p>${main}<p>${bounds}</p><div class="actions"><a href="/agents">Agent policy and reviews</a><a href="/app/settings/credentials">Machine credentials</a></div>` }), { status, headers: { ...headers, 'content-type': 'text' + '/html; charset=utf-8' } })
 const form = (filters: Pick<ActivityFilters, 'from' | 'through' | 'agent' | 'class'>) => `<section class="panel"><h2>Choose activity</h2><form method="get" action="${activityRoot}"><div class="fields"><label>From (UTC)<input type="date" name="from" value="${esc(filters.from)}" required></label><label>Through (UTC)<input type="date" name="through" value="${esc(filters.through)}" required></label><label>Agent ID<input type="text" name="agent" maxlength="200" value="${esc(filters.agent)}" aria-describedby="agent-help"></label><div class="control"><label for="activity-class">Class</label><select id="activity-class" name="class"><option value="">All classes</option>${classIds.map(cls => `<option value="${cls}"${filters.class === cls ? ' selected' : ''}>${cls}</option>`).join('')}</select></div></div><p id="agent-help">Leave Agent ID empty for all agents, or use an ID from an action’s recorded fields.</p><div class="actions"><button type="submit" class="primary">Apply filters</button><a href="${activityRoot}">Reset filters</a></div></form></section>`
 try {
  const filters = activityFilters(url), { data, serialized } = await readActivity(request, env, actor, filters)
  if (exporting) return new Response(serialized, { headers: { ...headers, 'content-type': 'application' + '/json; charset=utf-8', 'content-disposition': `attachment; filename="bifocal-agent-activity-${filters.from}-${filters.through}.json"` } })
  const pages = Math.max(1, Math.ceil(data.count / activityLimits.pageSize)), page = Math.min(filters.page, pages), start = (page - 1) * activityLimits.pageSize
  const selected = data.records.slice(start, start + activityLimits.pageSize)
  const counts = (title: string, values: Record<string, number>) => `<section class="panel"><h2>${title}</h2><ul class="records">${Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `<li><span>${esc(key)}</span><strong>${count}</strong></li>`).join('') || '<li>No matching actions</li>'}</ul></section>`
  const exportUrl = href(filters).replace(activityRoot, activityRoot + '/export')
  return document(`${form(filters)}<p role="status">${data.count} matching actions. ${selected.length ? `Showing ${start + 1}–${start + selected.length}.` : 'No actions match these filters.'}</p><div class="actions"><a href="${esc(exportUrl)}" download>Export complete JSON</a></div><div class="cards">${counts('Counts by class', data.counts.classes)}${counts('Counts by decision', data.counts.decisions)}</div><p>An action carrying multiple classes counts once in each class. Decisions count each action once.</p>${data.differsFromPolicy ? '<p class="warning">The audit API reported policy replay differences in the scanned agent and class scope. Inspect the recorded policy fields before relying on this history.</p>' : ''}<section class="panel"><h2>Recorded actions</h2>${selected.map(row => `<article class="history-item" data-audit-id="${esc(row.id)}"><h3>${esc(row.label)}</h3><p>${esc(row.at)} · ${esc(row.tool)}</p><p>${esc(row.decision)} · ${esc(row.outcome)} · ${esc(row.classes.map(item => item.class).join(', ') || 'No recorded class')}</p><a href="${esc(href({ ...filters, agent: row.agent.id }))}">Filter this agent</a><details><summary>Recorded fields</summary><pre>${esc(JSON.stringify(row, null, 2))}</pre></details></article>`).join('') || '<p>No recorded actions in this selection. Change the filters to browse another period.</p>'}</section><nav class="actions" aria-label="Activity pages">${page > 1 ? `<a href="${esc(href(filters, page - 1))}">Previous actions</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${esc(href(filters, page + 1))}">Next actions</a>` : ''}</nav>`)
 } catch (error) {
  const code = error instanceof ActivityError ? error.code : 'audit_unavailable', status = error instanceof ActivityError ? error.status : 503
  if (exporting || status === 403) return refusal(code, status)
  const fallback = activityFilters(new URL(url.origin + activityRoot))
  const submitted = { ...fallback, ...Object.fromEntries(['from', 'through', 'agent', 'class'].map(key => [key, (url.searchParams.get(key) ?? fallback[key as keyof typeof fallback]).toString().slice(0, 200)])) }
  const message = code === 'activity_capacity' ? 'Activity exceeds this request’s capacity. No complete counts or export were produced. Narrow the filters and try again.' : code === 'invalid_filters' ? 'Choose valid UTC dates in order, an agent ID and a listed class. Apply the corrected filters to try again.' : 'Activity is unavailable. No complete counts or export were produced. Apply filters to try again.'
  return document(`<p role="alert" class="status" data-error="true">${message}</p>${form(submitted)}`, status)
 }
}
