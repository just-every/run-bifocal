import { escapeHtml } from './shell'
import { identity } from '../identity'

const icon = (path: string) => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg>`
const FILE = icon('M5 2.5h6.5L15 6v11.5H5zM11.5 2.5V6H15M7.5 10h5M7.5 13h5')
const CALENDAR = icon('M3.5 4.5h13v12h-13zM3.5 8h13M7 2.5v4M13 2.5v4')
const SNAPSHOT = icon('M3.5 4.5h13v11h-13zM3.5 8.5h13M8 8.5v7M3.5 12h13')
const READY = icon('M4 10.5l3.5 3.5L16 5.5')

export type HomeApp = { href: string; title: string; version: number; audiences: { name: string }[] }
const appsPanel = (apps: HomeApp[]) => apps.length ? `<section class="panel" id="home-apps"><h2 class="cardhead">Your apps</h2><ul class="library-list">${apps.map(app => `<li class="library-row"><div><a class="library-name" href="${escapeHtml(app.href)}">${escapeHtml(app.title)}</a><p class="meta">${app.audiences.map(a => escapeHtml(a.name)).join(', ')} · version ${app.version}</p></div></li>`).join('')}</ul></section>` : ''

export function homePage(operator: { displayName: string; role: string }, apps: HomeApp[] = []) {
 return `<div class="pagehead"><div><h1>App home</h1><p class="meta">Signed in as ${escapeHtml(operator.displayName)}<span class="dot">·</span>${escapeHtml(operator.role)}</p></div></div>
${appsPanel(apps)}<div class="cards"><section class="panel"><h2 class="cardhead"><span class="disc">${READY}</span>Foundation is ready</h2><p>Sign-in, first-run setup and account tools are available in this installation.</p></section>
<section class="panel"><h2 class="cardhead">Native data tools</h2><p>Owners can review and import bounded CSV/XLSX files, manage US company calendars and currency rates, run exact queries and retain tabular dashboard/report answers.</p><ul class="facts"><li>${FILE}<span>CSV and XLSX files</span><span class="fact">up to 512 KiB, 2,000 rows, 64 columns</span></li><li>${CALENDAR}<span>US calendars and currency rates</span><span class="fact">versioned</span></li><li>${SNAPSHOT}<span>Exact answers</span><span class="fact">immutable snapshots</span></li></ul></section></div>
<p class="note">General source sync, semantic-model authoring, SQL/notebooks and scheduled delivery remain unfinished. Installation archives are separate from business-data imports.</p>
<p class="links"><a href="/app/library">Library</a> <span class="dot">·</span> <a href="${escapeHtml(identity.runSite!)}/run">Run and installation guide</a> <span class="nowrap"><span class="dot">·</span><a href="${escapeHtml(identity.runSite!)}/contract">Product contract</a></span></p>`
}
