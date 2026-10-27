// Plain sentences for refused owner forms on Metrics, Goals and Data quality: which field is at fault and what to do,
// in the person's words. The refusal itself (status, no write) is decided by the handlers; this only explains it.
import type { Refusal } from './forms'

type Values = Record<string, unknown>
const value = (values: Values, name: string) => typeof values[name] === 'string' ? (values[name] as string).trim() : ''
const stableId = (v: string) => /^[a-z][a-z0-9-]{0,63}$/.test(v)
const idSentence = (v: string, example: string) => v ? `Use lowercase letters, digits and hyphens, starting with a letter (for example, ${example}).` : 'Enter an ID.'
const refusal = (form: string, values: Values, code: string, field: string | null, message: string): Refusal => ({ form, values, field, message, code })

const JSON_TYPO = 'This isn’t valid JSON. Check for a missing quote, comma or closing brace.'
const ZONE_CHANGED = 'The organization time zone changed after this metric was defined. Propose a revision with the current time zone at Metrics, then certify it.'

function metricDefinitionSentence(code: string) {
 switch (code) {
  case 'invalid_metric_definition': return JSON_TYPO
  case 'metric_definition_required': return 'Enter the definition as one JSON object.'
  case 'unsupported_field': return 'Keep only name, description, grain, unit, timezone, accountingBasis and query in the definition.'
  case 'nonempty_text_required': return 'Fill in name, description, grain, unit, timezone and accountingBasis; none can be blank or overlong.'
  case 'metric_requires_one_scalar_single_source_measure': return 'A metric’s query needs exactly one measure, with no joins and no grouping.'
  case 'invalid_metric_timezone': return 'The definition’s timezone isn’t a known time zone. Use a name like America/New_York.'
  case 'metric_semantics_mismatch': return 'The unit and accountingBasis must match the query’s measure unit and accounting basis.'
  case 'dataset_not_found': return 'The query’s dataset hasn’t been imported. Import it at Files, or correct the dataset ID.'
  case 'company_conventions_required': case 'invalid_company_conventions': return 'Save your company conventions at Company before defining metrics.'
  case 'body_too_large': return 'This definition is too long to save. Keep it under 32 KB.'
  default: return 'The query in this definition doesn’t run. Check its dataset, measure and context against an exact answer that does.'
 }
}

/** Metrics: the create form, a metric's propose, approve and deprecate forms, and the pages themselves. */
export function metricRefusal(form: string, code: string, values: Values): Refusal {
 const at = (field: string | null, message: string) => refusal(form, values, code, field, message)
 if (form === 'create') {
  const id = value(values, 'id')
  if (['stable_id_required', 'nonempty_text_required'].includes(code) && !stableId(id)) return at('id', idSentence(id, 'net-revenue'))
  if (code === 'stale_metric_revision') return at('id', 'A metric with this ID already exists. Choose another ID, or open that metric to propose a change.')
  if (code === 'metric_deprecated') return at('id', 'A deprecated metric already uses this ID. Choose another ID.')
  return at('definition', metricDefinitionSentence(code))
 }
 if (form === 'propose') {
  if (code === 'stale_metric_revision') return at(null, 'A newer revision was saved while you were editing, so your draft wasn’t saved. It’s kept below beside the current version: compare them, then save again.')
  if (code === 'metric_deprecated') return at(null, 'This metric was deprecated, so it can’t take new revisions.')
  return at('definition', metricDefinitionSentence(code))
 }
 if (form === 'approve' || form === 'deprecate') {
  const verb = form === 'approve' ? 'certified' : 'deprecated'
  if (code === 'stale_metric_approval') return at(null, `This metric changed after the page loaded, so nothing was ${verb}. Review the current version below, then try again.`)
  if (code === 'native_owner_confirmation_required') return at('confirm', form === 'approve' ? 'Tick the box to confirm you approve this exact definition.' : 'Tick the box to confirm you reviewed the definition and its dependent content.')
  if (code === 'nonempty_text_required') return form === 'approve' ? at('annotation', 'Enter a dated change annotation: what you checked and why it’s right.') : at('reason', 'Enter the reason for deprecating this metric.')
  if (code === 'metric_deprecated') return at(null, 'This metric is already deprecated.')
  if (code === 'metric_timezone_changed') return at(null, ZONE_CHANGED)
  return at(null, form === 'approve' ? 'This definition doesn’t produce a value from the current data, so it can’t be certified yet.' : 'This metric couldn’t be deprecated because it or its data changed. Review the current version, then try again.')
 }
 if (form === 'series-review' || form === 'series-create') {
  // The review page's create form carries no fields of its own, so its sentence returns to the chart form.
  const chart = (field: string | null, message: string) => refusal('series-review', values, code, field, message)
  if (code === 'nonempty_text_required') return value(values, 'title') ? chart('dateColumn', 'Enter the name of a date column.') : chart('title', 'Enter a chart title.')
  if (code === 'metric_date_column_required') return chart('dateColumn', `${value(values, 'dateColumn')} isn’t a date column of this metric’s dataset. Enter the name of a date column, for example date.`)
  if (code === 'certified_metric_changed' || code === 'exact_current_metric_chart_review_required') return chart(null, 'The certified metric or its data changed after your review, so no chart was made. Review the date series again.')
  if (code === 'metric_not_certified') return chart(null, 'Certify a revision of this metric before charting it.')
  return chart(null, 'That chart couldn’t be made because the metric or its data changed. Review the date series again.')
 }
 if (code === 'metric_not_found') return at(null, 'There’s no metric with this ID. It may have been erased.')
 if (code === 'query_parameters_not_supported') return at(null, 'This page doesn’t take query parameters.')
 if (code === 'metric_not_certified') return at(null, 'Certify a revision of this metric before running it.')
 return at(null, 'That didn’t go through because the metric or its data changed. Review the page, then try again.')
}

function goalPeriodField(values: Values): [string, string] {
 const from = value(values, 'from'), to = value(values, 'to'), target = value(values, 'target'), age = Number(value(values, 'maxAgeSeconds'))
 if (from && to && from >= to) return ['to', 'The period must end after it starts.']
 if (from && to && (Date.parse(to) - Date.parse(from)) / 86400000 > 366) return ['to', 'A goal period can be at most 366 days.']
 if (!/^\d{1,16}\.\d{2}$/.test(target) || /^0+\.00$/.test(target)) return ['target', 'Enter a positive amount with two decimal places, for example 10000.00.']
 if (!Number.isSafeInteger(age) || age < 1 || age > 2592000) return ['maxAgeSeconds', 'Enter a whole number of seconds from 1 to 2592000 (30 days).']
 return ['target', 'Goals take a US dollar target with two decimal places.']
}

const EASEL: Record<string, [string, string]> = {
 easel_plan_series_required: ['easelSeries', 'Choose a plan series; Actual isn’t a plan.'],
 stale_easel_export: ['easelRevision', 'This Easel dataset changed or wasn’t found. Enter its current reviewed revision from Files.'],
 reviewed_easel_export_required: ['easelDataset', 'This dataset wasn’t imported as an Easel export. Import the original Easel CSV at Files with source kind Easel export.'],
 easel_dataset_source_link_required: ['easelDataset', 'This dataset’s source link isn’t an Easel dataset address. Re-import it with its Easel dataset URL.'],
 easel_dataset_columns_required: ['easelDataset', 'This dataset doesn’t have the Easel export columns. Import the original, unedited Easel CSV.'],
 complete_easel_month_period_required: ['from', 'Easel targets need whole months inside the export’s window: start and end the period on the 1st.'],
 easel_month_missing_or_duplicated: ['easelRow', 'The export needs exactly one row per month for this row ID and series.'],
 easel_USD_minor_units_required: ['easelRow', 'The selected Easel rows must be whole US cents.'],
 easel_exact_minor_units_required: ['easelRow', 'The selected Easel amounts are too large to add up exactly.'],
 positive_easel_target_required: ['easelRow', 'The selected Easel rows must add up to more than zero.'],
 reviewed_easel_target_mismatch: ['target', 'Target must equal the reviewed Easel sum for this period.'],
}

/** Goals: the create form, a goal's check-in and revise forms, and the pages themselves. */
export function goalRefusal(form: string, code: string, values: Values): Refusal {
 const at = (field: string | null, message: string) => refusal(form, values, code, field, message)
 if (form === 'checkin') {
  if (code === 'valid_date_required') return at('observedOn', 'Enter the observation date.')
  if (code === 'nonempty_text_required') return at('observation', 'Enter what you observed.')
  if (code === 'stale_goal_version') return at(null, 'This goal changed after the page loaded, so the check-in wasn’t added. Your note is kept; add it again.')
  return at(null, 'The check-in wasn’t added. Review the page, then try again.')
 }
 if (form === 'create' || form === 'revise') {
  if (form === 'create') {
   const id = value(values, 'id'), metric = value(values, 'metricId')
   if (['stable_id_required', 'nonempty_text_required'].includes(code) && !stableId(id)) return at('id', idSentence(id, 'q3-revenue'))
   if (['stable_id_required', 'nonempty_text_required'].includes(code) && !stableId(metric)) return at('metricId', idSentence(metric, 'net-revenue'))
   if (code === 'metric_not_found') return at('metricId', `There’s no metric with the ID ${metric}. Use the ID of a certified metric from Metrics.`)
   if (code === 'goal_conflict') return at('id', 'This goal couldn’t be saved; a goal with this ID may already exist. Choose another ID.')
  }
  if (code === 'certified_metric_required') return at('metricId', 'This metric has no certified revision yet. Certify it at Metrics first.')
  if (code === 'certified_USD_metric_required') return at('metricId', 'Goals need a certified metric measured in US dollars, to two decimal places.')
  if (code === 'date_column_required') return at('dateColumn', 'The metric’s dataset has no date column with this name.')
  if (code === 'valid_date_required') return at(/^\d{4}-\d{2}-\d{2}$/.test(value(values, 'from')) ? 'to' : 'from', 'Enter a date.')
  if (code === 'goal_requires_USD_target_period_and_freshness') { const [field, message] = goalPeriodField(values); return at(field, message) }
  if (EASEL[code]) return at(...EASEL[code])
  if (code === 'nonempty_text_required') {
   for (const [field, message] of [['title', 'Enter a title.'], ['dateColumn', 'Enter the name of the date column that dates each actual.']] as const) if (!value(values, field)) return at(field, message)
   for (const field of ['easelDataset', 'easelRevision', 'easelRow', 'easelSeries']) if (!value(values, field)) return at(field, 'Fill in all four Easel fields, or leave all four blank.')
   if (!stableId(value(values, 'easelDataset'))) return at('easelDataset', idSentence(value(values, 'easelDataset'), 'easel-plan'))
   return at('title', 'Keep the title under 160 characters.')
  }
  if (code === 'stale_goal_version') return at(null, 'This goal changed after the page loaded, so your revision wasn’t saved. Your entries are kept; review the current target, then save again.')
  if (code === 'metric_timezone_changed') return at('metricId', ZONE_CHANGED)
  return at('metricId', 'This metric doesn’t produce a value from the current data, so the goal can’t track it yet.')
 }
 if (code === 'goal_not_found') return at(null, 'There’s no goal with this ID. It may have been erased.')
 if (code === 'query_parameters_not_supported') return at(null, 'This page doesn’t take query parameters.')
 return at(null, 'That didn’t go through because the goal or its metric changed. Review the page, then try again.')
}

function ruleSentence(code: string) {
 switch (code) {
  case 'invalid_rule': return JSON_TYPO
  case 'rule_required': return 'Enter the rule as one JSON object with a name and a kind.'
  case 'unsupported_field': return 'Keep only name, kind, column, maxAgeSeconds, values and expected in the rule.'
  case 'nonempty_text_required': return 'Give the rule a name, and name the column it checks.'
  case 'invalid_rule_kind': return 'Use one of these kinds: freshness, not-null, unique, accepted-values, count or money.'
  case 'freshness_limit_required': return 'A freshness rule needs maxAgeSeconds: a whole number from 1 to 2592000.'
  case 'accepted_values_required': return 'An accepted-values rule needs values: a list of 1 to 100 text, true, false or null entries.'
  case 'count_required': return 'A count rule needs expected: the row count as text, for example "300".'
  case 'money_required': return 'A money rule needs expected: an amount with two decimal places as text, for example "17202.70".'
  case 'column_not_found': return 'The dataset has no column with this name.'
  default: return 'This rule couldn’t be saved. Check its kind and fields, then try again.'
 }
}

/** Data quality: the add-rule form, each rule's run, each failed run's waiver, and the page itself. */
export function qualityRefusal(form: string, code: string, values: Values): Refusal {
 const at = (field: string | null, message: string) => refusal(form, values, code, field, message)
 if (form === 'rule') {
  const id = value(values, 'id'), dataset = value(values, 'dataset')
  if (['stable_id_required', 'nonempty_text_required'].includes(code) && !stableId(id)) return at('id', idSentence(id, 'orders-not-null'))
  if (['stable_id_required', 'nonempty_text_required'].includes(code) && !stableId(dataset)) return at('dataset', idSentence(dataset, 'demo-orders'))
  if (code === 'dataset_not_found') return at('dataset', `No dataset with the ID ${dataset} has been imported. Import it at Files first.`)
  if (code === 'quality_conflict') return at('id', 'This rule couldn’t be saved; a rule with this ID may already exist. Choose another ID.')
  return at('definition', ruleSentence(code))
 }
 if (form.startsWith('waive-')) {
  if (code === 'future_expiry_within_30_days_required') return at('expiresAt', 'This expiry has passed, isn’t a time, or is more than 30 days away. Choose a time within the next 30 days.')
  if (code === 'nonempty_text_required') return at('reason', 'Enter the reason for this exception.')
  if (code === 'failed_run_required') return at(null, 'Only a failed run can be waived, and this one no longer is.')
  return at(null, 'The waiver wasn’t recorded. Review the page, then try again.')
 }
 if (code === 'rule_not_found') return at(null, 'That rule no longer exists.')
 if (code === 'query_parameters_not_supported') return at(null, 'This page doesn’t take query parameters.')
 return at(null, 'That didn’t go through because the rule or its data changed. Review the page, then try again.')
}
