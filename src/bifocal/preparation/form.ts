// Preparation drafts use the owner forms' rhythm (see ../metrics/forms): each label over its field, one filled action,
// and each subsection opening on a hairline with its heading clear of the field above. preparation.js writes a refusal's
// plain sentence at the field it concerns (or once at the top of the card) and keeps what the person typed.
const control = (id: string, label: string, field: string, hint = '') => `<div class="control"><label for="${id}">${label}</label>${field}${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}</div>`
const operations = [['dedupe', 'Deduplicate complete rows'], ['cast', 'Repair column type'], ['calculate', 'Calculate column'], ['join', 'Join dataset'], ['lookup', 'Look up dataset'], ['union', 'Union dataset'], ['pivot', 'Pivot'], ['unpivot', 'Unpivot'], ['rename', 'Rename column'], ['select', 'Select columns'], ['remove', 'Remove columns'], ['reorder', 'Reorder columns'], ['sort', 'Sort rows']].map(([value, label]) => `<option value="${value}">${label}</option>`).join('')

export const preparationForm = `<section id="preparation" class="panel" aria-labelledby="preparation-title">
<h2 id="preparation-title">Preparation drafts</h2>
<p>Build a visual transformation or edit its equivalent native SQL. Review complete output, validation errors and column lineage before saving an exact draft revision.</p>
<p id="prep-status" class="status" role="status" aria-live="polite"></p>
<form id="preparation-form" novalidate>
<div class="fields">${control('prep-id', 'Preparation ID', '<input id="prep-id" name="preparation" required pattern="[a-z][a-z0-9-]{0,63}" maxlength="64">')}${control('prep-dataset', 'Source dataset ID', '<input id="prep-dataset" name="dataset" required pattern="[a-z][a-z0-9-]{0,63}" maxlength="64">')}</div>
<div class="actions"><button id="prep-load" type="button">Load saved preparation</button><button id="prep-source-load" type="button">Inspect source columns</button></div>
<div id="prep-source"></div>
<h3 class="prep-subhead">Draft</h3><p id="prep-version" class="meta">No saved preparation loaded.</p>
${control('prep-mode', 'Editing form', '<select id="prep-mode" name="mode"><option value="visual">Visual steps</option><option value="sql">Native SQL</option></select>')}
<div id="prep-visual"><h4 class="prep-graph-title">Transformation graph</h4><p id="prep-graph-source" class="hint">Source → sequential steps → draft output</p><div id="prep-steps"></div>
<div class="prep-add">${control('prep-operation', 'Add operation', `<select id="prep-operation">${operations}</select>`)}<button id="prep-add" type="button">Add step</button></div></div>
<div id="prep-sql-editor" hidden><h4 class="prep-graph-title">Equivalent native SQL</h4>${control('prep-sql', 'SQL statements', '<textarea id="prep-sql" name="sql" rows="10" maxlength="48000" spellcheck="false" aria-describedby="prep-sql-hint"></textarea>', 'This bounded dialect executes the same operations as the graph. Each statement reads INPUT from the preceding step. Use quoted column and dataset names. Review SQL to update the visual steps. Arbitrary SQL and source writes are refused.')}</div>
<div class="actions"><button id="prep-review-button" class="primary" type="submit">Review preparation</button></div>
</form>
<section id="prep-review" hidden aria-labelledby="prep-review-title"><h3 id="prep-review-title" class="prep-subhead">Review draft output</h3><div id="prep-review-report"></div><label class="checkbox"><input id="prep-confirm" type="checkbox">I reviewed these exact rows, errors, source revisions and digest</label><div class="actions"><button id="prep-save" class="primary" type="button" disabled>Save reviewed draft</button></div></section>
<section aria-labelledby="prep-history-title"><h3 id="prep-history-title" class="prep-subhead">Saved preparation revisions</h3><p class="hint">Load a revision to edit or review it, then explicitly restore it as a new draft revision. Restore requires unchanged source revisions.</p>${control('prep-revision', 'Saved revision', '<select id="prep-revision" disabled><option value="">Load a saved preparation first</option></select>')}<div class="actions"><button id="prep-revision-load" type="button" disabled>Load selected revision</button><button id="prep-restore-review" type="button" disabled>Review selected revision for restore</button></div><div id="prep-history"></div></section>
<details><summary>Who can see drafts</summary><p class="hint">Owner-only drafts. Saving or restoring a preparation does not publish data or change a source, model or chart. Dependency scheduling is unavailable.</p></details>
</section>`
