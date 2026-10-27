// The installed app's one frame, after the owner's approved app look A (round 2, h1; 26 Oct 2026): a white top bar with
// the vector mark 4 (the real spectacles), the wordmark, the daily tools this account can open and a Settings menu; a
// left list; one main pane. Every signed-in app document renders through it, so the bar, its links and Sign out exist
// once. Only existing workflows are linked; the lockup opens app home.
import { fontHead } from '../base/font-head'
import { iconHead } from '../base/icon-head'

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export type Viewer = { displayName: string; role: string }
export type Place = 'home' | 'answers' | 'metrics' | 'files' | 'library' | 'company' | 'people' | 'library-settings' | 'export' | 'settings' | 'guide'
type Link = [Place | '', string, string, (role: string) => boolean]

// The bar holds daily work only, as h1's Questions · Metrics · Sources · Reports; configuration sits in Settings at right.
const TOOLS: Link[] = [
 ['answers', 'Answers', '/app/queries', role => role === 'owner'],
 ['metrics', 'Metrics', '/app/metrics', role => role === 'owner'],
 ['files', 'Files', '/app/import', role => role === 'owner'],
 ['library', 'Library', '/app/library', () => true],
]
const SETTINGS: Link[] = [
 ['company', 'Company', '/app/company', role => role === 'owner'],
 ['people', 'People', '/app/people', role => ['owner', 'admin'].includes(role)],
 ['library-settings', 'Library settings', '/app/library/settings', role => role === 'owner'],
 ['export', 'Export limits', '/app/settings/export', role => role === 'owner'],
 ['settings', 'Your settings', '/app/settings', () => true],
 ['', 'Identity settings', '/auth/settings/identity', role => role === 'owner'],
]

/** Every app page's styles and fonts are same-origin files; nothing inline. */
export const appPolicy = "style-src 'self'; font-src 'self'; img-src 'self'"

const lockup = '<a class="lockup" href="/app"><picture><source srcset="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)"><img src="/brand/mark.svg" alt="" width="76" height="36"></picture><span data-rer-name>Bifocal</span></a>'

function initials(name: string) {
 const letters = name.split(/\s+/).map(word => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '').filter(Boolean)
 return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0] ?? '·').toUpperCase()
}

/** A person's initials disc, the one avatar the bar and People draw. */
export const avatar = (name: string) => `<span class="avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>`

// On a phone the named Settings control is its gear alone; its tooltip also opens on keyboard focus.
const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>'

function topBar(viewer: Viewer | null, place: Place) {
 if (!viewer) return `<header class="topbar">${lockup}</header>`
 const links = (list: Link[]) => list.filter(([, , , allowed]) => allowed(viewer.role)).map(([id, label, href]) => `<a href="${href}"${id === place ? ' aria-current="page"' : ''}>${label}</a>`).join('')
 const configuring = SETTINGS.some(([id]) => id === place)
 const menu = `<details class="menu"><summary aria-label="Settings" aria-describedby="settings-tooltip"${configuring ? ' data-current="true"' : ''}>${GEAR}<span class="menu-label">Settings</span><span id="settings-tooltip" class="control-tooltip" role="tooltip">Open settings</span></summary><nav class="menu-panel" aria-label="Settings">${links(SETTINGS)}<form method="post" action="/auth/signout"><button type="submit" class="quiet">Sign out</button></form></nav></details>`
 return `<header class="topbar">${lockup}<nav class="tools" aria-label="App">${links(TOOLS)}</nav><div class="account">${avatar(viewer.displayName)}<span class="who">${escapeHtml(viewer.displayName)}</span>${menu}</div></header>`
}

/** The left column of every Settings page and the guide: the Settings menu's places with the current one marked, then
 * this installation's guides. One list, so each Settings page reads as the same place. */
export function accountSide(role: string, place: Place) {
 const link = (id: Place | '', href: string, label: string) => `<a href="${href}"${id && id === place ? ' aria-current="page"' : ''}>${label}</a>`
 return `<nav class="sidelist" aria-label="Settings and installation"><p class="side-heading">Settings</p>${SETTINGS.filter(([, , , allowed]) => allowed(role)).map(([id, label, href]) => link(id, href, label)).join('')}<p class="side-heading">This installation</p>${link('guide', '/docs', 'Installation guide')}${link('', '/', 'Lobby')}</nav>`
}

export function appDocument({ title, viewer, place, side = '', main, skip = 'Skip to content', head = '', body = '' }: { title: string; viewer: Viewer | null; place: Place; side?: string; main: string; skip?: string; head?: string; body?: string }) {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${iconHead}${fontHead}<link rel="stylesheet" href="/app-theme.css"><link rel="stylesheet" href="/bifocal/app.css">${head}</head><body${body}><a class="skip" href="#main">${skip}</a>${topBar(viewer, place)}<div class="layout${side ? '' : ' single'}">${side ? `<aside class="side">${side}</aside>` : ''}<main class="main" id="main">${main}</main></div></body></html>`
}
