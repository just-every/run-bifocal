// The Data quality page: overall state, the rules with their run actions, then the add-rule form and each failed run's
// waiver in its own card. A refused submit comes back through the same builder with the person's values.
import { escapeHtml } from '../../app/shell'
import { details, hidden } from '../metrics/transport'
import { actions, control, formPanel, refusalLine, SEP, type Refusal } from '../metrics/forms'

type RuleRow = { id: string; dataset_id: string; rule_json: string }
type History = { id: string; rule_id: string; result: { state: string } }
type Quality = { state: string; tests: Record<string, unknown>[] }

const STATES: Record<string, string> = { passed: 'Passed', failed: 'Failed', unknown: 'Not checked on current data' }

export function qualityMain(rules: RuleRow[], histories: History[], quality: Quality, refusal?: Refusal) {
 const last = (id: string) => STATES[String(quality.tests.find(test => test.ruleId === id)?.state ?? 'unknown')] ?? 'Not checked on current data'
 const list = rules.length ? `<ul class="records">${rules.map(r => `<li><span class="record"><strong>${escapeHtml((JSON.parse(r.rule_json) as { name: string }).name)}</strong><span class="row-meta">${[r.dataset_id, r.id, last(r.id)].join(SEP)}</span></span><form method="post" action="/api/operator/quality/rules/${r.id}/run"><button type="submit">Run ${escapeHtml(r.id)}</button></form></li>`).join('')}</ul><p class="hint">Run checks the current source data now and records the result with its source revision.</p>` : '<p class="muted">No rules yet. Add the first one below.</p>'
 const rule = `<div class="fields">${control('rule', 'id', 'Rule ID', { refusal, hint: 'Lowercase letters, digits and hyphens, for example orders-not-null.' })}${control('rule', 'dataset', 'Dataset ID', { refusal, hint: 'An imported dataset, as named at Files.' })}</div>`
  + control('rule', 'definition', 'Rule definition (JSON)', { refusal, rows: 6, hint: 'Kinds: freshness, not-null, unique, accepted-values, count, money. Supply a name and the relevant column, expected value, accepted values or maximum age in seconds.' })
 const names = new Map(rules.map(r => [r.id, (JSON.parse(r.rule_json) as { name: string }).name]))
 const waivers = histories.filter(r => r.result.state === 'failed').map(r => formPanel(`waive-${r.id}`, `Review waiver for ${names.get(r.rule_id) ?? r.rule_id}`, `/api/operator/quality/runs/${r.id}/waive`,
  `<p class="meta">Failed run ${r.id}</p><p class="hint">A waiver records an exception until it expires; it never turns a failure into healthy data.</p><div class="fields">${control(`waive-${r.id}`, 'reason', 'Exception reason', { refusal })}${control(`waive-${r.id}`, 'expiresAt', 'Expiry (ISO timestamp)', { refusal, hint: 'Within the next 30 days, for example 2026-11-15T17:00:00Z.' })}</div>${hidden('confirm', 'waive')}` + actions('Record expiring waiver', false), refusal)).join('')
 return `<p class="meta">Overall: ${escapeHtml(quality.state[0].toUpperCase()+quality.state.slice(1))}</p>${refusalLine(refusal, 'page')}${details('Current tests and expiry', quality)}<section class="panel"><h2>Rules</h2>${refusalLine(refusal, 'run')}${list}</section>`
  + formPanel('rule', 'Add a quality rule', '/api/operator/quality/rules', rule + actions('Save rule'), refusal)
  + details('Run history with source revision and failing row numbers', histories) + waivers
}
