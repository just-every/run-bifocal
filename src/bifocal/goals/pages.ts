// The Goals list and a goal's page: records first, then each form in its own card. A refused submit comes back
// through the same builders with the person's values (see ../metrics/forms).
import { escapeHtml } from '../../app/shell'
import { details, hidden } from '../metrics/transport'
import { actions, control, formPanel, refusalLine, type Refusal } from '../metrics/forms'

export type GoalDefinition = { title: string; from: string; to: string; dateColumn: string; target: string; currency: 'USD'; maxAgeSeconds: number; easel?: { link: string; series: string } & Record<string, unknown> }
export type GoalRow = { id: string; owner_id: string; metric_id: string; version: number }
export type GoalView = { goal: GoalRow; definition: GoalDefinition; versions: unknown[]; checkins: unknown[]; actual: Record<string, unknown> }

const EASEL = [['easelDataset', 'Easel dataset ID'], ['easelRevision', 'Reviewed dataset revision'], ['easelRow', 'Easel row ID'], ['easelSeries', 'Easel plan series']]

function easelFields(form: string, refusal?: Refusal) {
 const mine = refusal?.form === form ? refusal : undefined
 const open = !!mine && (EASEL.some(([name]) => name === mine.field) || EASEL.some(([name]) => typeof mine.values[name] === 'string' && (mine.values[name] as string).trim() !== ''))
 return `<details${open ? ' open' : ''}><summary>Use an Easel target export</summary><p class="hint">First review and apply the original Easel dataset CSV at <a href="/app/import">Files</a>, selecting its source kind and dataset URL. Enter its current dataset revision, exact row ID and plan series, and enter the reviewed sum in Target. Only complete USD month periods are accepted; the export’s digest records its snapshot. Changing this target by hand later creates a separate version without Easel provenance.</p><div class="fields">${EASEL.map(([name, label]) => control(form, name, label, { refusal, required: false })).join('')}</div></details>`
}

function goalFields(form: string, refusal?: Refusal, v?: GoalDefinition) {
 const at = (name: string, label: string, value?: string, kind?: string, hint?: string) => control(form, name, label, { refusal, value, kind, hint })
 return `<div class="fields">${at('title', 'Title', v?.title)}${at('dateColumn', 'Actuals date column', v?.dateColumn, undefined, 'The date column in the metric’s dataset that dates each actual.')}${at('from', 'Period start', v?.from, 'date')}${at('to', 'Period end (exclusive)', v?.to, 'date', 'At most 366 days after the start.')}${at('target', 'Target (USD, two decimal places)', v?.target)}${at('maxAgeSeconds', 'Maximum source age in seconds', String(v?.maxAgeSeconds ?? 86400), 'number', 'Older source data shows as stale, never as on pace.')}</div>${hidden('currency', 'USD')}${easelFields(form, refusal)}`
}

export function goalsMain(rows: (GoalRow & { document_json: string })[], refusal?: Refusal) {
 const list = rows.length ? `<ul class="records">${rows.map(row => { const d = JSON.parse(row.document_json) as GoalDefinition; return `<li><span class="record"><a href="/app/goals/${row.id}">${escapeHtml(d.title)}</a><span class="row-meta">${row.id} · ${escapeHtml(d.target)} USD · ${d.from} to ${d.to} · ${row.metric_id}</span></span></li>` }).join('')}</ul>` : '<p class="muted">No goals yet. Create the first one below.</p>'
 const create = `<div class="fields">${control('create', 'id', 'Goal ID', { refusal, hint: 'Lowercase letters, digits and hyphens, for example q3-revenue.' })}${control('create', 'metricId', 'Certified metric ID', { refusal, hint: 'A certified metric in US dollars, from <a href="/app/metrics">Metrics</a>.' })}</div>${goalFields('create', refusal)}`
 return `${refusalLine(refusal, 'page')}<section class="panel"><h2>Your goals</h2>${list}</section>${formPanel('create', 'Create a revenue goal', '/api/operator/goals', create + actions('Save goal'), refusal)}`
}

export function goalMain({ goal, definition: def, versions, checkins, actual }: GoalView, refusal?: Refusal) {
 const easel = def.easel ? `<a href="${escapeHtml(def.easel.link)}" rel="noreferrer">Easel plan dataset</a> · ${escapeHtml(def.easel.series)}` : 'Easel plan: not attached to this target version'
 const checkin = formPanel('checkin', 'Owner check-in', `/api/operator/goals/${goal.id}/checkins`, hidden('previousVersion', goal.version)
  + `<div class="fields">${control('checkin', 'observedOn', 'Observation date', { refusal, kind: 'date' })}${control('checkin', 'observation', 'Observation', { refusal, hint: 'A dated note beside the actuals; it never changes them.' })}</div>` + actions('Add check-in'), refusal)
 const revise = formPanel('revise', 'Change target or period', `/api/operator/goals/${goal.id}/revise`, hidden('previousVersion', goal.version)
  + goalFields('revise', refusal, def) + '<p class="hint">Saving creates target version ' + (goal.version + 1) + '; earlier versions stay in Target versions.</p>' + actions('Save target revision', false), refusal)
 return `<p class="lead">Target ${escapeHtml(def.target)} USD · ${def.from} to ${def.to} (exclusive) · Target version ${goal.version}</p><p class="meta">Actuals: ${escapeHtml(String(actual.state))} · ${escapeHtml(String(actual.status))} · ${easel}</p>`
  + refusalLine(refusal, 'page') + details('Actual query, source freshness and pace', actual) + (def.easel ? details('Easel export provenance', def.easel) : '')
  + checkin + details('Attributed check-ins', checkins) + revise + details('Target versions', versions)
}
