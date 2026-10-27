import { appDocument, appPolicy, escapeHtml, type Viewer } from '../../app/shell'

/** Mounted by the chart transport after checking current-owner authority. */
export function editorPage(viewer:Viewer,queryId=''):Response {
 const main=`<h1>Chart builder</h1><p class="lead">Start from a saved answer, choose its fields, then review the current exact values before creating a chart.</p>
<p id="chart-editor-status" class="status" role="status" aria-live="polite">Loading saved answers…</p>
<noscript><p class="note">Enable JavaScript to load saved answers and review a chart.</p></noscript>
<form id="chart-editor-form" data-query="${escapeHtml(queryId)}">
 <section class="panel" aria-labelledby="chart-source-heading">
  <h2 id="chart-source-heading">Saved answer</h2>
  <div class="control"><label for="chart-query">Source answer</label><select id="chart-query" required disabled><option value="">Choose a saved answer</option></select><p class="hint">Review runs the saved definition against current sources. The source answer remains immutable.</p></div>
  <div class="actions"><button id="chart-reload" type="button">Reload saved answers</button><a id="chart-source-link" hidden>Open source answer</a></div>
  <p id="chart-source-note" class="meta"></p>
  <p id="chart-empty" class="note" hidden>No saved answers are available. <a href="/app/queries">Create an exact answer</a>, then return to build a chart.</p>
 </section>
 <fieldset id="chart-options" disabled>
  <legend>Chart settings</legend>
  <div class="fields">
   <label for="chart-title">Chart title<input id="chart-title" maxlength="160" required></label>
   <label for="chart-kind">Chart type<select id="chart-kind" aria-label="Chart type"><option value="vertical-bar">Vertical bar</option><option value="line">Line</option><option value="stepped-line">Stepped line</option><option value="area">Area</option></select></label>
   <label for="chart-dimension">Dimension<select id="chart-dimension" aria-label="Dimension" required></select></label>
   <label for="chart-measure">Measure<select id="chart-measure" aria-label="Measure" required></select></label>
   <label for="chart-order-field">Order by<select id="chart-order-field" aria-label="Order by" required></select></label>
   <label for="chart-order-direction">Order direction<select id="chart-order-direction" aria-label="Order direction"><option value="ascending">Ascending</option><option value="descending">Descending</option></select></label>
   <label for="chart-order-nulls">Missing values in order<select id="chart-order-nulls" aria-label="Missing values in order"><option value="last">Nulls last</option><option value="first">Nulls first</option></select></label>
   <div class="control"><label for="chart-scale">Value scale</label><select id="chart-scale" aria-label="Value scale" aria-describedby="chart-scale-hint"><option value="zero">Include zero</option><option value="auto" disabled>Automatic range</option></select><p class="hint" id="chart-scale-hint">Vertical bars and areas always include zero.</p></div>
   <label for="chart-selection">Selection dimension<select id="chart-selection" aria-label="Selection dimension" required></select></label>
  </div>
  <p class="hint">Missing values stay visible as gaps. Chart selections narrow displayed rows; totals retain the complete query context.</p>
 </fieldset>
 <div class="actions"><button id="chart-review" class="primary" type="submit" disabled>Review current chart</button><button id="chart-create" type="button" disabled>Create reviewed chart</button></div>
 <p class="hint" id="chart-review-hint">Review the current definition and values to enable creation. Every edit clears the review.</p>
</form>
<section id="chart-editor-review" aria-labelledby="chart-review-heading" hidden>
 <h2 class="section" id="chart-review-heading" tabindex="-1">Current exact review</h2>
 <p id="chart-review-summary" class="meta"></p>
 <div id="chart-review-rows" class="panel tablepanel"></div>
 <details class="panel"><summary>Reviewed definition and exact answer</summary><pre id="chart-review-document"></pre></details>
</section>`
 return new Response(appDocument({title:'Chart builder · Bifocal',viewer,place:'answers',side:'<h2 class="side-heading">Answer tools</h2><nav class="sidelist" aria-label="Answer tools"><a href="/app/queries">Retained answers</a><a href="/app/charts/new" aria-current="page">Chart builder</a><a href="/app/dashboard-authoring">Dashboard authoring</a></nav>',main,head:'<script type="module" src="/bifocal/chart-editor.js"></script>'}),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}})
}
