import type { Filter, Measure } from '../../query/types'
import { plannerFail, type PlannerInput } from './types'
import { civil, plain, shortText, validatePeriod } from './validate'
function inputError(): never { return plannerFail('planner_input_invalid', 400) }
function names(values: unknown, allowed: Set<string>, max: number): asserts values is string[] {
 if (!Array.isArray(values) || values.length > max || new Set(values).size !== values.length || values.some(value => typeof value !== 'string' || !allowed.has(value))) inputError()
}
function filters(values: Filter[], allowed: Set<string>): Filter[] {
 if (!Array.isArray(values) || values.length > 32) inputError()
 return values.map(filter => {
  if (!plain(filter) || !allowed.has(filter.column) || !['eq', 'ne', 'in', 'gte', 'lte', 'is-null'].includes(filter.op)) inputError()
  if (filter.op === 'is-null') { if (filter.value !== undefined) inputError(); return { column: filter.column, op: filter.op } }
  const value = filter.value, valid = (v: unknown) => v === null || typeof v === 'boolean' || shortText(v, 1600, true)
  if (filter.op === 'in' ? !Array.isArray(value) || value.length > 100 || value.some(v => !valid(v)) : Array.isArray(value) || !valid(value)) inputError()
  return { column: filter.column, op: filter.op, value: Array.isArray(value) ? [...value] : value }
 })
}
function measure(value: Measure, allowed: Set<string>): object {
 if (!plain(value) || !shortText(value.id, 160) || !['sum', 'count', 'count-distinct', 'ratio', 'weighted-average'].includes(value.op) || !['money', 'number', 'count', 'percent'].includes(value.unit) || !Number.isInteger(value.scale) || value.scale < 0 || value.scale > 12) inputError()
 const result: Record<string, unknown> = { id: value.id, op: value.op, unit: value.unit, scale: value.scale }
 // The definition may refer to a hidden source column. Only catalog-visible
 // references can be disclosed, even though native execution may use it.
 for (const field of ['column', 'numerator', 'denominator', 'weight', 'stateColumn', 'currencyColumn', 'rateDateColumn'] as const) if (typeof value[field] === 'string' && allowed.has(value[field]!)) result[field] = value[field]
 if (value.empty === 'null' || value.empty === 'zero') result.empty = value.empty
 if (typeof value.sourceCurrency === 'string' && /^[A-Z]{3}$/.test(value.sourceCurrency)) result.sourceCurrency = value.sourceCurrency
 return result
}
function calendar(definition: Record<string, unknown>): object {
 if (!plain(definition)) inputError()
 const result: Record<string, unknown> = {}
 for (const key of ['name', 'kind', 'anchor', 'holidays']) if (definition[key] !== undefined) { if (!shortText(definition[key], 160)) inputError(); result[key] = definition[key] }
 for (const key of ['startMonth', 'startDay', 'weekStartsOn', 'extraWeekPeriod']) if (definition[key] !== undefined) { if (!Number.isSafeInteger(definition[key])) inputError(); result[key] = definition[key] }
 for (const key of ['closed', 'open']) if (definition[key] !== undefined) { const dates = definition[key]; if (!Array.isArray(dates) || dates.length > 1000 || dates.some(value => !civil(value))) inputError(); result[key] = [...dates] }
 return result
}
/** Explicit projection is the egress boundary. Additional model keys, source
 * rows, query results, rule literals and hidden field names never leave it. */
export function questionOutbound(input: PlannerInput): object {
 if (!plain(input) || !shortText(input.question, 4096) || !civil(input.asOf) || !plain(input.model)) inputError()
 const model = input.model
 for (const value of [model.id, model.revision, model.viewId]) if (!shortText(value, 160)) inputError()
 if (!shortText(model.timezone, 100) || !Array.isArray(model.dimensions) || model.dimensions.length > 64 || !Array.isArray(model.measures) || model.measures.length > 64) inputError()
 const dimensions = model.dimensions.map(d => { if (!plain(d) || !shortText(d.column, 256) || !['text', 'number', 'money', 'date', 'boolean'].includes(d.type)) inputError(); return { column: d.column, type: d.type } })
 const allowed = new Set(dimensions.map(d => d.column))
 if (allowed.size !== dimensions.length || !plain(model.calendar) || !shortText(model.calendar.id, 160) || !Number.isSafeInteger(model.calendar.version) || model.calendar.version < 1 || !Array.isArray(model.immutableFilters) || !Array.isArray(model.rowRules) || model.immutableFilters.length > 128 || model.rowRules.length > 128) inputError()
 const measures = model.measures.map(value => measure(value, allowed)), measureIds = new Set(model.measures.map(value => value.id))
 if (measureIds.size !== measures.length) inputError()
 const restrictionColumns = [...new Set([...model.immutableFilters, ...model.rowRules].flatMap(filter => plain(filter) && typeof filter.column === 'string' && allowed.has(filter.column) ? [filter.column] : []))]
 let context: object | null = null
 if (input.context !== null) {
  const current = input.context; if (!plain(current)) inputError()
  names(current.groupBy, allowed, 8); names(current.measureIds, measureIds, 16)
  if (current.period !== null) validatePeriod(current.period, input)
  context = { groupBy: [...current.groupBy], measureIds: [...current.measureIds], filters: filters(current.filters, allowed), period: current.period === null ? null : { kind: current.period.kind, column: current.period.column, asOf: current.period.asOf, from: current.period.from, to: current.period.to } }
 }
 let fiscal: Record<string, unknown> | null = null
 if (model.fiscal !== null) {
  if (!plain(model.fiscal)) inputError()
  fiscal = {}
  for (const key of ['column', 'dateColumn']) if (typeof model.fiscal[key] === 'string' && allowed.has(model.fiscal[key] as string)) fiscal[key] = model.fiscal[key]
  if (Object.keys(fiscal).length) {
   for (const key of ['from', 'to', 'asOf', 'quarterStart', 'yearStart']) if (civil(model.fiscal[key])) fiscal[key] = model.fiscal[key]
   for (const key of ['year', 'quarter', 'period']) if (Number.isSafeInteger(model.fiscal[key])) fiscal[key] = model.fiscal[key]
  }
 }
 const outbound = { question: input.question, asOf: input.asOf, context, model: { id: model.id, revision: model.revision, viewId: model.viewId, dimensions, measures, calendar: { id: model.calendar.id, version: model.calendar.version, definition: calendar(model.calendar.definition) }, timezone: model.timezone, fiscal, immutableRestrictions: { present: model.immutableFilters.length + model.rowRules.length > 0, restrictionCount: model.immutableFilters.length + model.rowRules.length, rowRuleCount: model.rowRules.length, columns: restrictionColumns } } }
 if (new TextEncoder().encode(JSON.stringify(outbound)).byteLength > 65536) plannerFail('planner_too_large', 413)
 return outbound
}
