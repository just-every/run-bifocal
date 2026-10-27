// The Metrics list and a metric's page: records first, then each form in its own card. A refused submit comes back
// through the same builders with the person's values (see ./forms).
import { escapeHtml } from '../../app/shell'
import { details, hidden } from './transport'
import { actions, checkbox, control, disclosure, formPanel, refusalLine, SEP, type Refusal } from './forms'
import type { MetricDocument, MetricRow, Revision } from './store.server'

const pretty = (json: string) => JSON.stringify(JSON.parse(json), null, 2)
const certified = (n: number) => `<span class="lens">Certified revision ${n}</span>`

export function metricsMain(rows: (MetricRow & { document_json: string })[], refusal?: Refusal) {
 const state = (r: MetricRow) => r.deprecated_at ? 'Deprecated' : r.published_revision ? certified(r.published_revision) + (r.head_revision !== r.published_revision ? SEP + 'Draft revision ' + r.head_revision : '') : 'Draft'
 const list = rows.length ? `<ul class="records">${rows.map(r => `<li><span class="record"><a href="/app/metrics/${r.id}">${escapeHtml((JSON.parse(r.document_json) as MetricDocument).name)}</a><span class="row-meta">${state(r)}${SEP}${r.id}</span></span></li>`).join('')}</ul>` : '<p class="muted">No metrics yet. Create the first one below.</p>'
 const create = control('create', 'id', 'Stable metric ID', { refusal, hint: 'Lowercase letters, digits and hyphens, for example net-revenue.' })
  + control('create', 'definition', 'Metric definition (JSON)', { refusal, rows: 12, hint: 'Name, description, grain, unit, timezone, accountingBasis and one scalar exact query, in the same conventions as Exact answers. A draft never changes a certified version.' })
 return `${refusalLine(refusal, 'page')}<section class="panel"><h2>Your metrics</h2>${list}</section>${formPanel('create', 'Create a metric', '/api/operator/metrics', create + actions('Save draft'), refusal)}`
}

export type MetricView = { row: MetricRow; revisions: Revision[]; head: Revision; doc: MetricDocument; impact: unknown }

export function metricMain({ row, revisions, head, doc, impact }: MetricView, ownerEmail: string, refusal?: Refusal) {
 const id = row.id, live = !row.deprecated_at
 const state = row.deprecated_at ? 'Deprecated — unavailable for new use' : row.published_revision ? certified(row.published_revision) : 'Draft — not certified'
 // A confirmation only carries over when it still names the revision on screen.
 const same = refusal?.values.revision === String(head.revision) && refusal?.values.digest === head.digest
 const approve = live && !head.approved_at ? formPanel('approve', 'Review exact definition', `/api/operator/metrics/${id}/approve`,
  hidden('revision', head.revision) + hidden('digest', head.digest) + disclosure('Definition to approve', doc)
  + control('approve', 'annotation', 'Dated change annotation', { refusal })
  + checkbox('approve', 'confirm', 'approve', 'I approve this exact metric definition', refusal, same) + actions(`Certify revision ${head.revision}`), refusal) : ''
 const stale = refusal?.form === 'propose' && refusal.code === 'stale_metric_revision'
 const draft = control('propose', 'definition', 'Revised metric definition (JSON)', { refusal, rows: 14, value: pretty(head.document_json), hint: 'Saving makes a new draft revision; the certified version stays in use until you certify the draft.' })
 const beside = `<div class="fields">${draft}<div class="control"><label for="propose-current">Current version (revision ${head.revision})</label><textarea id="propose-current" rows="14" readonly spellcheck="false">${escapeHtml(pretty(head.document_json))}</textarea></div></div>`
 const propose = live ? formPanel('propose', 'Propose a change', `/api/operator/metrics/${id}/propose`, hidden('previousRevision', row.head_revision) + (stale ? beside : draft) + actions('Save proposed revision', false), refusal) : ''
 const deprecate = live && row.published_revision ? formPanel('deprecate', 'Deprecate metric', `/api/operator/metrics/${id}/deprecate`,
  '<p class="hint">New runs and goal actuals become unavailable. Retained reports keep their original definitions and values.</p>'
  + hidden('revision', row.head_revision) + hidden('digest', head.digest) + hidden('publishedRevision', row.published_revision)
  + control('deprecate', 'reason', 'Deprecation reason', { refusal })
  + checkbox('deprecate', 'confirm', 'deprecate', 'I reviewed this definition and its dependent content', refusal, same && refusal?.values.publishedRevision === String(row.published_revision)) + actions('Deprecate metric', false), refusal) : ''
 const history = revisions.map(r => ({ revision: r.revision, definition: JSON.parse(r.document_json), digest: r.digest, createdAt: r.created_at, approvedAt: r.approved_at, annotation: r.annotation }))
 return `<p class="lead">${escapeHtml(doc.description)}</p><p class="meta">${state}${SEP}${row.head_revision !== row.published_revision ? 'Draft revision ' : 'Latest revision '}${row.head_revision}</p>`
  + `<p class="meta">${['Owner ' + ownerEmail, doc.grain, doc.unit, doc.timezone, doc.accountingBasis].map(escapeHtml).join(SEP)}</p>`
  + refusalLine(refusal, 'page') + details('Change impact and dependent content', impact)
  + (row.deprecated_at ? `<p role="status">Deprecated on ${escapeHtml(row.deprecated_at)}. ${escapeHtml(row.deprecated_reason ?? '')}</p>` : '')
  + approve + propose + deprecate + details('Immutable revision history', history)
}
