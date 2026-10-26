// The installed app's one frame, after the desk's approved app look (h1, 21 Oct 2026): a white top bar with mark 4, the
// wordmark and the tools this account can open; a left column; one main pane. Every signed-in app document renders
// through it, so the bar, its links and Sign out exist once. Only existing workflows are linked.
import { fontHead } from '../base/font-head'
import { iconHead } from '../base/icon-head'

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export type Viewer = { displayName: string; role: string }
export type Place = 'home' | 'apps' | 'files' | 'answers' | 'company' | 'people' | 'settings' | 'guide'

const TOOLS: [Place, string, string, (role: string) => boolean][] = [
 ['home', 'App home', '/app', () => true],
 ['apps', 'Apps', '/app/apps', () => true],
 ['files', 'Files', '/app/import', role => role === 'owner'],
 ['answers', 'Exact answers', '/app/queries', role => role === 'owner'],
 ['company', 'Company', '/app/company', role => role === 'owner'],
 ['people', 'People', '/app/people', role => ['owner', 'admin'].includes(role)],
]

/** Every app page's styles and fonts are same-origin files; nothing inline. */
export const appPolicy = "style-src 'self'; font-src 'self'; img-src 'self'"

const lockup = '<a class="lockup" href="/app"><picture><source srcset="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)"><img src="/brand/mark.svg" alt="" width="67" height="32"></picture><span data-rer-name>Bifocal</span></a>'

function initials(name: string) {
 const letters = name.split(/\s+/).map(word => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '').filter(Boolean)
 return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0] ?? '·').toUpperCase()
}

/** A person's initials disc, the one avatar the bar and People draw. */
export const avatar = (name: string) => `<span class="avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>`

function topBar(viewer: Viewer | null, place: Place) {
 const tools = viewer ? TOOLS.filter(([, , , allowed]) => allowed(viewer.role)).map(([id, label, href]) => `<a href="${href}"${id === place ? ' aria-current="page"' : ''}>${label}</a>`).join('') : ''
 const account = viewer ? `<div class="account">${avatar(viewer.displayName)}<span class="who">${escapeHtml(viewer.displayName)}</span><form method="post" action="/auth/signout"><button type="submit" class="quiet">Sign out</button></form></div>` : ''
 return `<header class="topbar">${lockup}${tools ? `<nav class="tools" aria-label="App">${tools}</nav>` : ''}${account}</header>`
}

/** The left column of the account pages: the signed-in person's own tools, then this installation's guides. */
export function accountSide(role: string, place: Place) {
 const link = (id: Place | '', href: string, label: string) => `<a href="${href}"${id === place ? ' aria-current="page"' : ''}>${label}</a>`
 return `<nav class="sidelist" aria-label="Account and installation"><p class="side-heading">Your account</p>${link('settings', '/app/settings', 'Your settings')}${role === 'owner' ? link('', '/auth/settings/identity', 'Identity settings') : ''}<hr><p class="side-heading">This installation</p>${link('guide', '/docs', 'Installation guide')}${link('', '/', 'Lobby')}</nav>`
}

export function appDocument({ title, viewer, place, side = '', main, skip = 'Skip to content', head = '', body = '' }: { title: string; viewer: Viewer | null; place: Place; side?: string; main: string; skip?: string; head?: string; body?: string }) {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${iconHead}${fontHead}<link rel="stylesheet" href="/app-theme.css"><link rel="stylesheet" href="/bifocal/app.css">${head}</head><body${body}><a class="skip" href="#main">${skip}</a>${topBar(viewer, place)}<div class="layout${side ? '' : ' single'}">${side ? `<aside class="side">${side}</aside>` : ''}<main class="main" id="main">${main}</main></div></body></html>`
}
