import {nativeReportPage} from './authoring/page.server'
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { appDocument, appPolicy, escapeHtml } from '../../app/shell'
import { displayZone } from '../company/display-zone'
import { fileOwner } from '../imports/files/owner.server'

const content = `<h1 id="report-title">Report artifact</h1><p id="report-status" class="status" role="status" aria-live="polite">Checking current access…</p>
<div class="actions"><button id="report-refresh" type="button">Refresh access</button><a id="report-sign-in" hidden>Sign in again</a></div>
<div id="report-workspace" hidden>
<section class="panel"><h2 id="report-state">Current custody state</h2><div id="report-metadata"></div><p id="report-correction"></p><div id="report-related"></div><p id="report-access"></p><p id="report-freshness" class="warning" hidden></p><p id="report-external-copies" hidden></p></section>
<section id="report-artifact" class="panel" hidden><h2>Immutable report contents</h2><p id="report-narrative"></p><div id="report-totals" class="kpis" aria-label="Artifact totals"></div><div id="report-rows"></div><details><summary>Metric versions, source cutoffs, filters and audience</summary><div id="report-cutoffs"></div><pre id="report-definition"></pre></details><details><summary>Complete immutable artifact JSON</summary><pre id="report-json"></pre></details><div class="actions"><button id="report-download" class="primary" type="button">Download exact artifact</button></div><p>Downloads require your current native sign-in and access to this exact version. An address or audience label does not grant access. Copies already downloaded to a device cannot be recalled.</p></section>
<section id="owner-report-tools" class="panel" hidden><h2>Named reviewer access</h2><p>Grant one active person access to this exact artifact. Each correction requires its own grant. This does not grant source data access or permission to render or send reports.</p><form id="report-grant-form"><div class="fields"><label>Named reviewer<select id="report-reviewer" aria-label="Named reviewer" required></select></label><label>Grant expires in device local time<input id="report-grant-expiry" aria-label="Grant expires in device local time" type="datetime-local" required></label></div><p>Choose an expiry within seven days and before this artifact’s retention cutoff.</p><button id="report-grant-review" type="submit">Review exact reviewer grant</button></form>
<div id="report-grant-preview" hidden><h3>Review this exact access grant</h3><div id="report-grant-summary"></div><label class="checkbox"><input id="report-grant-confirm" type="checkbox">I approve this named reviewer to download only this exact artifact version until the expiry shown</label><button id="report-grant-save" type="button" disabled>Grant reviewed access</button></div>
<h3>Recorded reviewer grants</h3><div id="report-grants"></div><details><summary>Pending recipients</summary><p>Pending recipients do not have artifact authority. Their current membership is checked before queued work proceeds.</p><div id="report-pending"></div></details></section>
<details id="report-owner-history" class="panel" hidden><summary>Custody audit and historical dispatch facts</summary><div id="report-history"></div></details>
</div>`

export async function reportRunPage(request: Request, original: Bindings): Promise<Response | null> {
 const native=await nativeReportPage(request,original);if(native)return native
 const path = new URL(request.url).pathname, match = /^\/app\/report-runs\/([a-f0-9-]{36})$/.exec(path)
 if (!match) return null
 const env = runtimeBindings(original), session = await operatorAuth(env).getSession(request)
 if (!session) return new Response(null, { status: 303, headers: { location: '/signin?returnTo=' + encodeURIComponent(path), 'cache-control': 'no-store' } })
 if (request.method !== 'GET') return new Response(null, { status: 405 })
 const owner = await fileOwner(request, env)
 return new Response(appDocument({
  title: 'Report artifact · Bifocal', viewer: session.operator, place: 'library',
  body: ' data-run-id="' + match[1] + '" data-zone="' + escapeHtml(await displayZone(env, session.operator.email)) + '"',
  head: '<link rel="stylesheet" href="/bifocal/report-custody.css"><script type="module" src="/bifocal/report-custody.js"></script>',
  side: '<nav class="sidelist" aria-label="Report access"><a href="' + path + '" aria-current="page">This report version</a>' + (owner ? '<a href="/app/queries">Exact answers</a><a href="/app/models">Semantic models</a>' : '') + '<a href="/app/settings">Your settings</a></nav>',
  main: content,
 }), { headers: {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': `default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}`,
 } })
}
