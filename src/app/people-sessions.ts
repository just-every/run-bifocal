import type { Operator } from '../modules/operator-auth/index.mjs'
import { escapeHtml } from './shell'
import type { AccountSession } from './settings'
import { stamp } from './time'

export function peopleSessionsPage(person: Operator, sessions: AccountSession[], currentId: string, zone: string, notice = '') {
 const time = (value: number) => `<time class="nowrap" datetime="${new Date(value).toISOString()}">${escapeHtml(stamp(value, zone))}</time>`
 const action = `/app/people/sessions?person=${encodeURIComponent(person.id)}`
 const active = sessions.filter(session => session.active)
 const rows = active.map(session => `<li class="panel session"><h2>${session.id === currentId ? 'This session' : 'Active session'}</h2><dl class="facts-grid"><div><dt>Sign-in method</dt><dd>${escapeHtml(session.kind)}</dd></div><div><dt>Started</dt><dd>${time(session.createdAt)}</dd></div><div><dt>Expires</dt><dd>${time(session.expiresAt)}</dd></div></dl><form method="post" action="${action}"><input type="hidden" name="sessionId" value="${escapeHtml(session.id)}"><button type="submit">${session.id === currentId ? 'End this session' : 'End session started ' + time(session.createdAt)}</button></form></li>`).join('')
 return `<div class="pagehead"><div><h1>Sessions for ${escapeHtml(person.displayName)}</h1><p class="lead">${escapeHtml(person.email)}</p></div></div><p><a href="/app/people">Back to People</a></p><p class="note">Ending a session refuses its next request. It does not deactivate the account or prevent a new sign-in. Ending this session returns you to sign-in.</p>${notice}${active.length ? `<ul class="cardlist" aria-label="Active sessions">${rows}</ul>` : '<p class="panel" role="status">No active sessions. This person can sign in again if their account is active.</p>'}`
}

export function peopleSessionsUnavailable() {
 return '<div class="pagehead"><div><h1>Sessions unavailable</h1></div></div><p class="status" data-error="true" role="alert">These sessions could not be loaded with your current access. Return to People to check the account, then try again.</p><p><a href="/app/people">Back to People</a></p>'
}
