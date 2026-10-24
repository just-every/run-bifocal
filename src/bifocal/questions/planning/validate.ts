import { driverColumns } from './schema'
import { plannerFail, type PlannerInput, type QuestionPeriod, type QuestionPlan } from './types'
export function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) }
function invalid(): never { return plannerFail('planner_invalid_response') }
export function shortText(value: unknown, max: number, allowEmpty = false): value is string { return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) }
export function civil(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1971-01-01' && value <= '9998-12-31' && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value }
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> { if (!plain(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) invalid() }
function list(value: unknown, max: number, allowed?: Set<string>): asserts value is string[] {
 if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length || value.some(item => !shortText(item, 256))) invalid()
 if (allowed && value.some(item => !allowed.has(item))) plannerFail('planner_scope_invalid')
}
export function validatePeriod(value: unknown, input: PlannerInput): asserts value is QuestionPeriod {
 exact(value, ['kind', 'column', 'asOf', 'from', 'to'])
 if (!['all', 'range', 'quarter-to-date', 'year-to-date', 'last-quarter', 'month', 'last-month'].includes(String(value.kind))) invalid()
 if (value.kind === 'all') { if (value.column !== '' || value.from !== '' || value.to !== '' || value.asOf !== '' && !civil(value.asOf)) invalid(); return }
 if (!input.model.dimensions.some(d => d.column === value.column && d.type === 'date')) plannerFail('planner_scope_invalid')
 if (value.asOf !== '' && !civil(value.asOf) || value.from !== '' && !civil(value.from) || value.to !== '' && !civil(value.to)) invalid()
 if (value.kind === 'range' && (!civil(value.from) || !civil(value.to) || value.from > value.to)) invalid()
 if (value.kind !== 'range' && !civil(value.asOf)) invalid()
}
export function validateQuestionPlan(value: unknown, input: PlannerInput): QuestionPlan {
 exact(value, ['decision', 'message', 'missing', 'intent', 'measureIds', 'groupBy', 'filters', 'period', 'comparison', 'drivers', 'priceVolume'])
 if (!['answer', 'clarify', 'refuse'].includes(String(value.decision)) || !['query', 'why'].includes(String(value.intent)) || !shortText(value.message, 2000)) invalid()
 const dimensions = new Set(input.model.dimensions.map(d => d.column)), measures = new Set(input.model.measures.map(m => m.id)), numeric = new Set(input.model.dimensions.filter(d => d.type === 'number' || d.type === 'money').map(d => d.column))
 list(value.missing, 16); list(value.measureIds, 16, measures); list(value.groupBy, 8, dimensions); list(value.drivers, 4, new Set(driverColumns(input)))
 if (!Array.isArray(value.filters) || value.filters.length > 32) invalid()
 for (const filter of value.filters) {
  exact(filter, ['column', 'op', 'value', 'values'])
  if (!dimensions.has(filter.column as string)) plannerFail('planner_scope_invalid')
  if (!['eq', 'ne', 'in', 'gte', 'lte'].includes(String(filter.op)) || !shortText(filter.value, 1600, true)) invalid()
  if (!Array.isArray(filter.values) || filter.values.length > 100 || new Set(filter.values).size !== filter.values.length || filter.values.some(item => !shortText(item, 1600, true))) invalid()
  if (filter.op === 'in' ? filter.value !== '' || !filter.values.length : filter.values.length !== 0) invalid()
 }
 validatePeriod(value.period, input); if (value.comparison !== null) validatePeriod(value.comparison, input)
 if (value.priceVolume !== null) {
  exact(value.priceVolume, ['revenue', 'quantity', 'product'])
  if (!numeric.has(value.priceVolume.revenue as string) || !numeric.has(value.priceVolume.quantity as string) || !dimensions.has(value.priceVolume.product as string) || value.priceVolume.revenue === value.priceVolume.quantity) plannerFail('planner_scope_invalid')
 }
 if (value.decision === 'answer' && (!value.measureIds.length || value.missing.length || value.intent === 'why' && value.comparison === null)) invalid()
 if (value.decision === 'answer' && value.intent === 'query' && (value.drivers.length || value.priceVolume !== null)) invalid()
 return value as unknown as QuestionPlan
}
