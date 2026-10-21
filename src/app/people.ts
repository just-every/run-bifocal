import type { Operator } from '../modules/operator-auth/index.mjs'
import { escapeHtml, navigation } from './navigation'

type Person = Operator & { signInUrl?: string }
export function peoplePage(people: Person[], role: string, notice = '') {
 const rows = people.map(person => `<li><h2>${escapeHtml(person.displayName)}</h2><dl><dt>Email</dt><dd>${escapeHtml(person.email)}</dd><dt>Foundation role</dt><dd>${escapeHtml(person.role)}</dd><dt>Status</dt><dd>${escapeHtml(person.status)}</dd></dl>${person.signInUrl ? `<p><a href="${escapeHtml(person.signInUrl)}">Sign in as ${escapeHtml(person.displayName)}</a></p>` : ''}</li>`).join('')
 return `<h1>People</h1><p>Manage this installation’s foundation accounts. Analytics roles and groups are not built yet.</p>${notice}<ul aria-label="People">${rows}</ul><h2>Invite a person</h2><p>Invitations grant only the selected foundation role. In development and demo, mail is suppressed; use the available “Sign in as” link.</p><form method="post" action="/auth/invite"><label>Name <input name="displayName" required maxlength="120" autocomplete="name"></label><label>Email <input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>Foundation role <select name="role"><option value="member">Member</option>${role === 'owner' ? '<option value="admin">Admin</option>' : ''}</select></label><button type="submit">Send invitation</button></form>${navigation(role)}`
}

export function peopleUnavailable(role: string) {
 return `<h1>People unavailable</h1><p role="alert">People and invitations require an active owner or admin account. If your access changed, sign in again. Otherwise, return to app home and retry.</p>${navigation(role)}`
}

export function inviteNotice(code: string) {
 const messages: Record<string, string> = {
  invalid_email: 'Enter a valid email address.',
  invalid_display_name: 'Enter a name of 1 to 120 characters.',
  invitation_conflict: 'That person already has an account or a different invitation. Check the people list before trying again.',
  rate_limited: 'Too many invitations were requested. Wait before trying again.',
  forbidden: 'Your current role cannot send this invitation.',
 }
 return `<p role="alert">${messages[code] ?? 'The invitation could not be completed. Check your access and the person’s details, then try again.'}</p>`
}
