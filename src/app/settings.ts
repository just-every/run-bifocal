import { escapeHtml } from './shell'

export type AccountSession = { id: string; kind: string; createdAt: number; expiresAt: number; active: boolean }

function sessionsList(sessions: AccountSession[] | null, currentId: string) {
 if (!sessions) return '<h2 class="section">Your sessions</h2><p class="status" data-error="true" role="alert">Sessions could not be loaded. Reload settings to try again.</p>'
 const date = (value: number) => escapeHtml(new Date(value).toISOString())
 const rows = sessions.filter(session => session.active).map(session => `<li class="panel session"><h3>${session.id === currentId ? 'This session' : 'Other session'}</h3><dl class="facts-grid"><div><dt>Sign-in method</dt><dd>${escapeHtml(session.kind)}</dd></div><div><dt>Started (UTC)</dt><dd><time class="mono" datetime="${date(session.createdAt)}">${date(session.createdAt)}</time></dd></div><div><dt>Expires (UTC)</dt><dd><time class="mono" datetime="${date(session.expiresAt)}">${date(session.expiresAt)}</time></dd></div></dl><form method="post" action="/auth/session/revoke"><input type="hidden" name="sessionId" value="${escapeHtml(session.id)}"><button type="submit">${session.id === currentId ? 'End this session' : 'End session started ' + date(session.createdAt)}</button></form></li>`).join('')
 return `<h2 class="section">Your sessions</h2><p class="lead">End an active session to refuse its next request. Ending this session returns you to sign-in.</p><ul class="cardlist" aria-label="Your active sessions">${rows || '<li class="panel">No active sessions.</li>'}</ul>`
}

export function settingsPage(operator: { displayName: string; email: string; role: string }, sessions: AccountSession[] | null, currentId: string, notice = '') {
 return `<div class="pagehead"><div><h1>Your settings</h1><p class="lead">Update the name shown for your signed-in account. Your email and access stay the same.</p></div></div>${notice}<section class="panel"><dl class="facts-grid"><div><dt>Email</dt><dd>${escapeHtml(operator.email)}</dd></div></dl><form class="inline-form" method="post" action="/auth/display-name"><label>Your name <input name="displayName" required maxlength="120" autocomplete="name" value="${escapeHtml(operator.displayName)}"></label><button type="submit" class="primary">Save name</button></form></section>${sessionsList(sessions, currentId)}`
}

export function nameNotice(code: string) {
 return `<p class="status" data-error="true" role="alert">${code === 'invalid_display_name' ? 'Enter a name of 1 to 120 characters, without control characters.' : 'Your name could not be saved. Check your sign-in and try again.'}</p>`
}

export function sessionNotice(code: string) {
 const messages: Record<string, string> = {
  forbidden: 'You cannot end that session. Only your own sessions are managed here.',
  session_not_found: 'That session is no longer available. Reload settings.',
  authority_changed: 'Your access changed. Sign in again before trying to end a session.',
  invalid_origin: 'This request did not come from this installation. Reload settings and try again.',
 }
 return `<p class="status" data-error="true" role="alert">${messages[code] ?? 'The session could not be ended. Reload settings and try again.'}</p>`
}
