import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { appDocument, appPolicy, escapeHtml } from '../../app/shell'
import { displayZone } from '../company/display-zone'
import { fileOwner } from '../imports/files/owner.server'

const author = `<h1>Ask a question</h1>
<p class="lead">Ask about a published model, review what goes to AI, then inspect the native query and exact answer.</p>
<p id="ask-status" class="status" role="status" aria-live="polite">Loading governed views…</p>
<div id="ask-workspace">
<section class="panel"><form id="ask-form">
<div class="fields"><label>Governed view<select id="ask-view" aria-label="Governed view" required></select></label><label>As of date<input id="ask-as-of" aria-label="As of date" type="date" required></label></div>
<label>Your question<textarea id="ask-question" aria-label="Your question" rows="4" maxlength="4096" required placeholder="Ask a question about the selected view."></textarea></label>
<details><summary>Definitions available to this question</summary><div id="ask-definitions"></div></details>
<details id="ask-context-details"><summary>Follow-up context</summary><p>Inspect or edit the dimensions, measures, filters and period carried into the next question. Resetting clears this context.</p><label>Question context (JSON)<textarea id="ask-context" aria-label="Question context (JSON)" rows="9" spellcheck="false">null</textarea></label><button id="ask-reset-context" type="button">Reset context</button></details>
<div class="actions"><button id="ask-preview" class="primary" type="submit">Review AI request</button></div>
</form></section>
<section id="ask-consent-panel" class="panel" hidden><h2>Review the exact AI request</h2><p id="ask-disclosure"></p><pre id="ask-outbound"></pre><p id="ask-policy" class="meta"></p><label class="checkbox"><input id="ask-consent" type="checkbox">I approve sending this exact question and permitted definitions to the configured AI provider</label><div class="actions"><button id="ask-send" class="primary" type="button" disabled>Send approved question</button></div></section>
<section id="ask-result" hidden><h2 id="ask-result-title">Saved question</h2><p id="ask-result-question"></p><p id="ask-result-message" class="status"></p><div id="ask-missing"></div>
<section id="ask-why-panel" class="panel" hidden><h3>Data quality and drivers</h3><div id="ask-why"></div></section>
<div id="ask-answer" hidden><div id="ask-totals" class="kpis" aria-label="Native answer totals"></div><p id="ask-scope"></p><p id="ask-quality" class="warning" hidden></p>
<section class="panel"><div class="fields"><label>Chart metric<select id="ask-chart-metric" aria-label="Chart metric"></select></label></div><div id="ask-chart"></div><div id="ask-table"></div></section>
<details class="panel"><summary>Exact query, metric definitions and interpreted dates</summary><div id="ask-query-link"></div><div id="ask-interpretation"></div><pre id="ask-query"></pre></details>
<details class="panel"><summary>Source citations and freshness</summary><div id="ask-sources"></div></details></div>
<details class="panel"><summary>AI provider and saved receipt</summary><div id="ask-provider"></div><pre id="ask-receipt"></pre></details>
<div class="actions"><button id="ask-follow-up" type="button" hidden>Use as follow-up context</button><a id="ask-saved-link">Reopen saved question</a></div>
</section></div>`

export async function questionPage(request: Request, original: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (path !== '/app/ask') return null
 const env = runtimeBindings(original), session = await operatorAuth(env).getSession(request)
 if (!session) return new Response(null, { status: 303, headers: { location: '/signin?returnTo=' + encodeURIComponent(path + new URL(request.url).search), 'cache-control': 'no-store' } })
 if (request.method !== 'GET') return new Response(null, { status: 405 })
 const owner = await fileOwner(request, env)
 return new Response(appDocument({
  title: 'Ask a question · Bifocal', viewer: session.operator, place: 'answers',
  body: owner ? ' data-zone="' + escapeHtml(await displayZone(env, session.operator.email)) + '"' : '',
  head: owner ? '<link rel="stylesheet" href="/bifocal/ask.css"><script type="module" src="/bifocal/ask.js"></script>' : '',
  side: '<nav class="sidelist" aria-label="Questions and models"><a href="/app/ask" aria-current="page">Ask a question</a><a href="/app/questions">Explore a question</a><a href="/app/models">Semantic models</a><a href="/app/calculations">Calculations</a><a href="/app/queries">Exact answers</a></nav><h2 class="side-heading">Saved AI questions</h2><div id="ask-history" class="sidelist"></div>',
  main: owner ? author : '<h1>Question access unavailable</h1><p>This workflow requires the current installation owner.</p><a href="/app">Back to app home</a>',
 }), { status: owner ? 200 : 403, headers: {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': `default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}`,
 } })
}
