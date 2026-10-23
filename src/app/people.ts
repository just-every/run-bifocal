import type { Operator } from '../modules/operator-auth/index.mjs'
import { avatar, escapeHtml } from './shell'

type Person = Operator & { signInUrl?: string }
function personControls(person: Person, actor: Operator) {
 if (person.id === actor.id || person.role === 'owner' || (actor.role !== 'owner' && person.role !== 'member')) return ''
 const name = escapeHtml(person.displayName)
 const id = `<input type="hidden" name="operatorId" value="${escapeHtml(person.id)}">`
 if (person.status === 'invited') return `<form method="post" action="/auth/invite/cancel">${id}<button type="submit">Cancel invitation for ${name}</button></form>`
 const inactive = person.status === 'inactive'
 return `<form method="post" action="/auth/operator/status">${id}<input type="hidden" name="status" value="${inactive ? 'active' : 'inactive'}"><button type="submit">${inactive ? 'Reactivate' : 'Deactivate'} ${name}</button></form>`
}

function sessionLink(person: Person, actor: Operator) {
 if (actor.role !== 'owner' && actor.id !== person.id && !(actor.role === 'admin' && person.role === 'member')) return ''
 return `<p><a href="/app/people/sessions?person=${encodeURIComponent(person.id)}">View sessions for ${escapeHtml(person.displayName)}</a></p>`
}

export function peoplePage(people: Person[], actor: Operator, notice = '') {
 const role = actor.role
 const rows = people.map(person => `<li class="person">${avatar(person.displayName)}<div class="person-main"><h2>${escapeHtml(person.displayName)}</h2><dl class="facts-grid"><div><dt>Email</dt><dd>${escapeHtml(person.email)}</dd></div><div><dt>Foundation role</dt><dd>${escapeHtml(person.role)}</dd></div><div><dt>Status</dt><dd><span class="state state-${escapeHtml(person.status)}">${escapeHtml(person.status)}</span></dd></div></dl>${sessionLink(person, actor)}${person.signInUrl ? `<p><a href="${escapeHtml(person.signInUrl)}">Sign in as ${escapeHtml(person.displayName)}</a></p>` : ''}</div>${personControls(person, actor)}</li>`).join('')
 return `<div class="pagehead"><div><h1>People</h1><p class="lead">Manage this installation’s foundation accounts. Analytics roles and groups are not built yet.</p></div></div><p class="note">Deactivation ends existing sessions and refuses new sign-ins. Reactivation never restores old sessions. Cancel an invitation to revoke its pending sign-in links; invite that person again to let them join. Owner changes require a separate fresh-proof path and are not offered here.</p>${notice}<ul class="panel people" aria-label="People">${rows}</ul><section class="panel"><h2 class="cardhead">Invite a person</h2><p>Invitations grant only the selected foundation role. In development and demo, mail is suppressed; use the available “Sign in as” link.</p><form method="post" action="/auth/invite"><div class="fields"><label>Name <input name="displayName" required maxlength="120" autocomplete="name"></label><label>Email <input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>Foundation role <select name="role"><option value="member">Member</option>${role === 'owner' ? '<option value="admin">Admin</option>' : ''}</select></label></div><div class="actions"><button type="submit" class="primary">Send invitation</button></div></form></section>`
}

export function peopleUnavailable() {
 return `<div class="pagehead"><div><h1>People unavailable</h1></div></div><p class="status" data-error="true" role="alert">People and invitations require an active owner or admin account. If your access changed, sign in again. Otherwise, return to app home and retry.</p>`
}

export function inviteNotice(code: string) {
 const messages: Record<string, string> = {
  invalid_email: 'Enter a valid email address.',
  invalid_display_name: 'Enter a name of 1 to 120 characters.',
  rate_limited: 'Too many invitations were requested. Wait before trying again.',
  forbidden: 'Your current role cannot manage this person.',
  invalid_origin: 'This change was refused because it did not come from this installation. Return to People and try again.',
  invitation_required: 'This invitation was cancelled. Send a new invitation with the same foundation role; reactivation cannot accept it.',
  invitation_conflict: 'The invitation changed or the person already joined. Reload People before trying again.',
  authority_changed: 'Access changed while saving. Reload People and check the current status.',
  operator_not_found: 'This account is no longer available. Reload People.',
  invalid_status: 'Choose an active or inactive account status.',
 }
 return `<p class="status" data-error="true" role="alert">${messages[code] ?? 'The people change could not be completed. Check your access and the person’s details, then try again.'}</p>`
}
