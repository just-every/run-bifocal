import { escapeHtml, navigation } from './navigation'

export function settingsPage(operator: { displayName: string; email: string; role: string }, notice = '') {
 return `<h1>Your settings</h1><p>Update the name shown for your signed-in account. Your email and access stay the same.</p>${notice}<dl><dt>Email</dt><dd>${escapeHtml(operator.email)}</dd></dl><form method="post" action="/auth/display-name"><label>Your name <input name="displayName" required maxlength="120" autocomplete="name" value="${escapeHtml(operator.displayName)}"></label><button type="submit">Save name</button></form>${navigation(operator.role)}`
}

export function nameNotice(code: string) {
 return `<p role="alert">${code === 'invalid_display_name' ? 'Enter a name of 1 to 120 characters, without control characters.' : 'Your name could not be saved. Check your sign-in and try again.'}</p>`
}
