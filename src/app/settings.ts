import { escapeHtml, navigation } from './navigation'

export type AccountSession = { id: string; kind: string; createdAt: number; expiresAt: number; active: boolean }

function sessionsList(sessions: AccountSession[] | null, currentId: string) {
 if (!sessions) return '<h2>Your sessions</h2><p role="alert">Sessions could not be loaded. Reload settings to try again.</p>'
 const date = (value: number) => escapeHtml(new Date(value).toISOString())
 const rows = sessions.filter(session => session.active).map(session => `<li><h3>${session.id === currentId ? 'This session' : 'Other session'}</h3><dl><dt>Sign-in method</dt><dd>${escapeHtml(session.kind)}</dd><dt>Started (UTC)</dt><dd><time datetime="${date(session.createdAt)}">${date(session.createdAt)}</time></dd><dt>Expires (UTC)</dt><dd><time datetime="${date(session.expiresAt)}">${date(session.expiresAt)}</time></dd></dl><form method="post" action="/auth/session/revoke"><input type="hidden" name="sessionId" value="${escapeHtml(session.id)}"><button type="submit">${session.id === currentId ? 'End this session' : 'End session started ' + date(session.createdAt)}</button></form></li>`).join('')
 return `<h2>Your sessions</h2><p>End an active session to refuse its next request. Ending this session returns you to sign-in.</p><ul aria-label="Your active sessions">${rows || '<li>No active sessions.</li>'}</ul>`
}

export function settingsPage(operator: { displayName: string; email: string; role: string }, sessions: AccountSession[] | null, currentId: string, notice = '') {
 return `<h1>Your settings</h1><p>Update the name shown for your signed-in account. Your email and access stay the same.</p>${notice}<dl><dt>Email</dt><dd>${escapeHtml(operator.email)}</dd></dl><form method="post" action="/auth/display-name"><label>Your name <input name="displayName" required maxlength="120" autocomplete="name" value="${escapeHtml(operator.displayName)}"></label><button type="submit">Save name</button></form>${sessionsList(sessions, currentId)}${navigation(operator.role)}`
}

export function nameNotice(code: string) {
 return `<p role="alert">${code === 'invalid_display_name' ? 'Enter a name of 1 to 120 characters, without control characters.' : 'Your name could not be saved. Check your sign-in and try again.'}</p>`
}

export function sessionNotice(code: string) {
 const messages: Record<string, string> = {
  forbidden: 'You cannot end that session. Only your own sessions are managed here.',
  session_not_found: 'That session is no longer available. Reload settings.',
  authority_changed: 'Your access changed. Sign in again before trying to end a session.',
  invalid_origin: 'This request did not come from this installation. Reload settings and try again.',
 }
 return `<p role="alert">${messages[code] ?? 'The session could not be ended. Reload settings and try again.'}</p>`
}
