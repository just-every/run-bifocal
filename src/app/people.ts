import type { Operator } from '../modules/operator-auth/index.mjs'
import { avatar, escapeHtml } from './shell'

type Person = Operator & { signInUrl?: string }
// An email may wrap only before its @ and dots, never between two letters of a word.
const emailBreaks = (email: string) => escapeHtml(email).replace(/[@.]/g, '<wbr>$&')
// The row already names the person, so the control shows only its verb; its accessible name still says whom it acts on.
// A short control leaves the name its room at every width (the name never breaks letter by letter).
function personControls(person: Person, actor: Operator) {
 if (person.id === actor.id || person.role === 'owner' || (actor.role !== 'owner' && person.role !== 'member')) return ''
 const name = escapeHtml(person.displayName)
 const id = `<input type="hidden" name="operatorId" value="${escapeHtml(person.id)}">`
 if (person.status === 'invited') return `<form method="post" action="/auth/invite/cancel">${id}<button type="submit" aria-label="Cancel invitation for ${name}">Cancel invitation</button></form>`
 const verb = person.status === 'inactive' ? 'Reactivate' : 'Deactivate'
 return `<form method="post" action="/auth/operator/status">${id}<input type="hidden" name="status" value="${person.status === 'inactive' ? 'active' : 'inactive'}"><button type="submit" aria-label="${verb} ${name}">${verb}</button></form>`
}

/** A refused invitation: the native refusal code and what the person typed into the invite form. */
export type InviteRefusal = { code: string; displayName: string; email: string; role: string }

const ROLE_NAMES: Record<string, string> = { owner: 'the owner', admin: 'an admin', member: 'a member' }
const roleName = (role: string) => ROLE_NAMES[role] ?? escapeHtml(role)
const roleLabel = (role: string) => escapeHtml(role.charAt(0).toUpperCase() + role.slice(1))

// The field at fault and one plain sentence for a refused invitation. A conflict is named from the same list this
// person already sees on the page: their own email, someone already here, or someone already invited. The native
// refusal itself is unchanged; anything not matched keeps its native explanation.
function inviteProblem(refusal: InviteRefusal, people: Person[], actor: Operator): { field: 'displayName' | 'email' | null; message: string } {
 const email = refusal.email.trim().toLowerCase()
 const existing = refusal.code === 'invitation_conflict' ? people.find(person => person.email.toLowerCase() === email) : undefined
 if (existing) {
  const name = escapeHtml(existing.displayName), sameRole = existing.role === refusal.role
  if (existing.id === actor.id) return { field: 'email', message: 'That’s your own email address. Enter the email of the person you want to invite.' }
  if (existing.status === 'invited' && !sameRole) return { field: 'email', message: `${name} is already invited as ${roleName(existing.role)}. To send their invitation again, choose ${roleLabel(existing.role)} as the foundation role.` }
  if (existing.status === 'active') return { field: 'email', message: `${name} is already a member here${existing.role === 'member' ? '' : `, as ${roleName(existing.role)}`}.` }
  if (existing.status === 'inactive') return { field: 'email', message: sameRole ? `${name} is already a member here, with an inactive account. Reactivate them in the list above.` : `${name} already has an inactive account here, as ${roleName(existing.role)}. Reactivate them in the list above or, if their invitation was cancelled, invite them again as ${roleName(existing.role)}.` }
 }
 const field = refusal.code === 'invalid_email' ? 'email' : refusal.code === 'invalid_display_name' ? 'displayName' : null
 return { field, message: inviteMessage(refusal.code) }
}

/** One invite field; a refused value comes back as typed, and the field at fault is marked, described and focused. */
function inviteField(name: 'displayName' | 'email', label: string, attrs: string, value: string, problem: { field: string | null; message: string } | null) {
 const input = `<input name="${name}" ${attrs} value="${escapeHtml(value)}"${problem?.field === name ? ` aria-invalid="true" aria-describedby="invite-${name}-error" autofocus` : ''}>`
 return problem?.field === name ? `<div class="control"><label>${label} ${input}</label><p class="field-error" id="invite-${name}-error">${problem.message}</p></div>` : `<label>${label} ${input}</label>`
}

export function peoplePage(people: Person[], actor: Operator, notice = '', refusal?: InviteRefusal) {
 const role = actor.role
 const problem = refusal ? inviteProblem(refusal, people, actor) : null
 const roles = [['member', 'Member'], ...(role === 'owner' ? [['admin', 'Admin']] : [])].map(([value, label]) => `<option value="${value}"${refusal?.role === value ? ' selected' : ''}>${label}</option>`).join('')
 const rows = people.map(person => `<li class="person">${avatar(person.displayName)}<div class="person-main"><h2>${escapeHtml(person.displayName)}</h2><dl class="facts-grid"><div><dt>Email</dt><dd>${emailBreaks(person.email)}</dd></div><div><dt>Foundation role</dt><dd>${escapeHtml(person.role)}</dd></div><div><dt>Status</dt><dd><span class="state state-${escapeHtml(person.status)}">${escapeHtml(person.status)}</span></dd></div></dl>${person.signInUrl ? `<p><a href="${escapeHtml(person.signInUrl)}">Sign in as ${escapeHtml(person.displayName)}</a></p>` : ''}</div>${personControls(person, actor)}</li>`).join('')
 return `<div class="pagehead"><div><h1>People</h1><p class="lead">Manage this installation’s foundation accounts.</p></div></div><p class="note">Deactivation ends existing sessions and refuses new sign-ins. Reactivation never restores old sessions. Cancel an invitation to revoke its pending sign-in links; invite that person again to let them join. Owner changes require a separate fresh-proof path and are not offered here.</p>${notice}<ul class="panel people" aria-label="People">${rows}</ul><section class="panel"><h2 class="cardhead">Invite a person</h2><p>Invitations grant only the selected foundation role.</p>${problem && !problem.field ? `<p class="status" data-error="true" role="alert">${problem.message}</p>` : ''}<form method="post" action="/auth/invite"><div class="fields">${inviteField('displayName', 'Name', 'required maxlength="120" autocomplete="name"', refusal?.displayName ?? '', problem)}${inviteField('email', 'Email', 'type="email" required maxlength="254" autocomplete="email"', refusal?.email ?? '', problem)}<label>Foundation role <select name="role">${roles}</select></label></div><div class="actions"><button type="submit" class="primary">Send invitation</button></div></form></section>`
}

export function peopleUnavailable() {
 return `<div class="pagehead"><div><h1>People unavailable</h1></div></div><p class="status" data-error="true" role="alert">People and invitations require an active owner or admin account. If your access changed, sign in again. Otherwise, return to app home and retry.</p>`
}

/** The plain sentence for a native people refusal; the code itself is never shown. */
export function inviteMessage(code: string) {
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
 return messages[code] ?? 'The people change could not be completed. Check your access and the person’s details, then try again.'
}

export const inviteNotice = (code: string) => `<p class="status" data-error="true" role="alert">${inviteMessage(code)}</p>`
