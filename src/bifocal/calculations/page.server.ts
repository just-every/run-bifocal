import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { appDocument, appPolicy } from '../../app/shell'
import { fileOwner } from '../imports/files/owner.server'

const author = `<h1>Calculations</h1>
<p class="lead">Build formulas on a governed view, inspect their translation and exact results, then save the reviewed library.</p>
<p id="status" class="status" role="status" aria-live="polite">Loading governed views…</p>
<div id="workspace">
<section class="panel"><h2>Calculation library</h2>
<div class="fields"><label>Governed view<select aria-label="Governed view" id="view" required></select></label><label>Saved library<select aria-label="Saved library" id="library"><option value="">New library</option></select></label></div>
<div class="fields"><label>Library id<input id="library-id" required maxlength="64" pattern="[a-z][a-z0-9-]{0,63}" placeholder="sales-calculations"></label><label>Library name<input id="label" required maxlength="160" placeholder="Sales calculations"></label></div>
<details><summary>Available fields and model context</summary><div id="view-context"></div></details>
<form id="formula-form"><h3>Write a formula</h3><div class="fields"><label>Calculation id<input id="calculation-id" required maxlength="64" pattern="[a-z][a-z0-9-]{0,63}" placeholder="total-revenue"></label><label>Formula language<select aria-label="Formula language" id="language"><option value="excel">Excel</option><option value="dax">DAX</option><option value="tableau">Tableau</option><option value="native">Native expression</option></select></label></div>
<div class="fields"><label>Calculation kind<select aria-label="Calculation kind" id="calculation-kind"><option value="measure">Measure</option><option value="field">Calculated field</option></select></label><label id="field-type-label" hidden>Field type<select aria-label="Field type" id="field-type" disabled><option value="number">Number</option><option value="text">Text</option><option value="date">Date</option><option value="boolean">Boolean</option></select></label></div>
<label>Formula or native expression JSON<textarea id="formula" rows="4" required spellcheck="false" placeholder="SUM([revenue])"></textarea></label>
<label>Format<input id="format" maxlength="160" placeholder="Optional format string"></label>
<div class="actions"><button type="submit">Add or update calculation</button><button id="clear-formula" type="button">Clear formula</button></div></form>
<div id="calculation-list"></div>
<details><summary>Edit the full library and evaluation context</summary><p>Calculation groups, precedence, what-if parameters and field parameters are part of the library. Model id, revision and view are bound to the governed view selected above.</p><label>Library definition (JSON)<textarea id="document" rows="18" spellcheck="false" required></textarea></label><button id="use-document" type="button">Use library definition</button></details>
<div class="actions"><button id="review" class="primary" type="button">Review calculations</button></div></section>
<section id="review-panel" class="panel" hidden><h2>Review this exact library</h2><div id="review-results"></div><div id="preview-results"></div><p id="review-digest" class="digest"></p><details><summary>Complete reviewed input and report</summary><pre id="review-json"></pre></details><label class="checkbox"><input id="approve" type="checkbox" disabled>I reviewed these exact formulas, results and evaluation semantics</label><button id="save" type="button" disabled>Save reviewed library</button></section>
<section id="run-panel" class="panel" hidden><h2>Run saved calculations</h2><p id="saved-note"></p><details><summary>Saved source translations and compatibility</summary><div id="saved-report"></div></details><details><summary>Filters and evaluation context</summary><p>Filters use field, op and value. Group by governed field ids; select calculation groups by id. What-if parameters use typed literal expressions. An optional fieldParameter object selects its declared id and choice.</p><label>Run options (JSON)<textarea aria-label="Run options (JSON)" id="run-options" rows="12" spellcheck="false">{
  "filters": [],
  "groupBy": [],
  "parameters": {},
  "groups": []
}</textarea></label></details><button id="run" class="primary" type="button">Run saved revision</button><div id="run-results" hidden></div></section>
<details class="panel"><summary>Migrate an original calculation library</summary><p>Original libraries use the shared Files import door, including exact plan approval, reconciliation and Undo. Bind the source to the governed view above before previewing.</p>
<form id="migration-form"><label>Original library JSON<input id="migration-file" type="file" accept=".json,application/json" required></label><p>A library envelope can contain calculations or a source object with format <code>tmdl</code> or <code>tableau</code> and its original content.</p><button type="submit">Preview migration</button></form>
<div id="migration-review" hidden><h3>Migration plan</h3><div id="migration-results"></div><details><summary>Complete migration plan</summary><pre id="migration-json"></pre></details><label class="checkbox"><input id="migration-approve" type="checkbox">I approve this exact migration plan and its source translations</label><div class="actions"><button id="migration-apply" type="button" disabled>Apply and reconcile</button><button id="migration-undo" type="button">Undo migration plan</button></div></div><div id="migration-receipt" hidden><h3>Reconciliation receipt</h3><pre id="migration-receipt-json"></pre><button id="migration-revert" type="button">Undo imported revision</button></div></details>
</div>`

export async function calculationPage(request: Request, original: Bindings): Promise<Response | null> {
 if (new URL(request.url).pathname !== '/app/calculations') return null
 const env = runtimeBindings(original), session = await operatorAuth(env).getSession(request)
 if (!session) return new Response(null, { status: 303, headers: { location: '/signin?returnTo=%2Fapp%2Fcalculations', 'cache-control': 'no-store' } })
 if (request.method !== 'GET') return new Response(null, { status: 405 })
 const owner = await fileOwner(request, env)
 return new Response(appDocument({
  title: 'Calculations · Bifocal', viewer: session.operator, place: 'answers',
  head: owner ? '<link rel="stylesheet" href="/bifocal/calculations.css"><script type="module" src="/bifocal/calculations.js"></script>' : '',
  side: '<nav class="sidelist" aria-label="Models and answers"><a href="/app/questions">Explore a question</a><a href="/app/models">Semantic models</a><a href="/app/calculations" aria-current="page">Calculations</a><a href="/app/queries">Exact answers</a><a href="/app/import">Files</a></nav>',
  main: owner ? author : '<h1>Calculation access unavailable</h1><p>This workflow requires the current installation owner.</p><a href="/app">Back to app home</a>',
 }), { status: owner ? 200 : 403, headers: {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': `default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}`,
 } })
}
