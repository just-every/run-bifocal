import { escapeHtml } from './shell'
import { identity } from '../identity'
import type { OwnerPlaces, PlaceRow } from '../bifocal/home/places.server'

export type HomeApp = { href: string; title: string; version: number; audiences: { name: string }[] }
const appsPanel = (apps: HomeApp[]) => apps.length ? `<section class="panel" id="home-apps"><h2 class="cardhead">Your apps</h2><ul class="library-list">${apps.map(app => `<li class="library-row"><div><a class="library-name" href="${escapeHtml(app.href)}">${escapeHtml(app.title)}</a><p class="meta">${app.audiences.map(a => escapeHtml(a.name)).join(', ')} · version ${app.version}</p></div></li>`).join('')}</ul></section>` : ''

// App home leads with the owner's daily places, h1's list rows in three cards: the latest dashboards, retained answers and
// datasets, each with its way in. Other people see the apps shared with them. Installation links sit in one quiet row.
function place(id: string, title: string, rows: PlaceRow[], empty: string, more: [string, string]) {
 const list = rows.length ? `<ul class="place-list">${rows.map(row => `<li><a href="${escapeHtml(row.href)}">${escapeHtml(row.name).replaceAll(' · ', ' ·\u00a0')}</a>${row.meta ? `<span class="row-meta">${escapeHtml(row.meta)}</span>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`
 return `<section class="panel place" aria-labelledby="place-${id}"><h2 class="cardhead" id="place-${id}">${title}</h2>${list}<p class="place-more"><a href="${more[1]}">${more[0]}</a></p></section>`
}

export function homePage(apps: HomeApp[] = [], places: OwnerPlaces | null = null) {
 const links = `<p class="links"><a href="/docs">Installation guide</a> <span class="dot">·</span><a href="/">Lobby</a> <span class="dot">·</span><a href="${escapeHtml(identity.runSite!)}/run">Run and installation guide</a> <span class="nowrap"><span class="dot">·</span><a href="${escapeHtml(identity.runSite!)}/contract">Product contract</a></span></p>`
 const body = places ? `<div class="places">${place('dashboards', 'Dashboards', places.dashboards, 'No saved dashboards yet. Save one from an answer.', ['Open the Library', '/app/library'])}${place('answers', 'Retained answers', places.answers, 'No answers yet.', ['All answers', '/app/queries'])}${place('files', 'Files', places.files, 'No datasets yet.', ['Import a file', '/app/import#prepare'])}</div>`
  : appsPanel(apps) || `<p class="lead"><a href="/app/library">Open the Library</a> for the dashboards and reports shared with you.</p>`
 return `<div class="pagehead"><div><h1>App home</h1></div></div>${body}${links}`
}
