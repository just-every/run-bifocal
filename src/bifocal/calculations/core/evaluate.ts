import { rational } from '../../currency/decimal'
import { aggregate } from './aggregate'
import { applyCalculationGroups } from './groups'
import { binary, scalarCall } from './scalar'
import { CALCULATION_SEMANTICS, reject, type CalculationAnswer, type CalculationExpr, type CalculationFilter, type CalculationRequest, type CalculationValue, type InputRow } from './types'
import { fields, validateExpression, validateFilters } from './validate'
import { cell, compare, nil, number, numeric, truth, valueKey } from './values'
import { windowValue } from './windows'

type Scope = { rows: readonly InputRow[]; dimensions: Record<string, CalculationValue>; filters: CalculationFilter[]; total: boolean; row?: InputRow; fixed?: boolean }
const own = (object: object, key: string) => Object.hasOwn(object, key)
const names = (values: { id: string }[]) => { if (values.some(value => typeof value.id !== 'string' || !value.id.length || value.id.length > 160) || new Set(values.map(value => value.id)).size !== values.length) reject('unique_calculation_ids_required') }

/** Pure bounded evaluator. Authorization must happen before supplying rows;
 * this API has no source resolver, database handle, code execution or network.
 * Every context transition derives rows from this same authorized row set. */
export function evaluateCalculations(request: CalculationRequest): CalculationAnswer {
 const { authorizedRows, schema, filters, groupBy, parameters = {}, calculationGroups = [] } = request
 if (!Array.isArray(authorizedRows) || authorizedRows.length > 2000 || !schema || typeof schema !== 'object' || Array.isArray(schema) || Object.keys(schema).length > 256 || Object.values(schema).some(type => !['number', 'text', 'date', 'boolean'].includes(type))) reject('invalid_calculation_dataset')
 if (!Array.isArray(request.measures) || !request.measures.length || request.measures.length > 64 || !Array.isArray(calculationGroups) || calculationGroups.length > 16 || !parameters || typeof parameters !== 'object' || Array.isArray(parameters) || Object.keys(parameters).length > 64) reject('calculation_request_limit')
 fields(groupBy, schema); validateFilters(filters, schema); names(request.measures); names(calculationGroups)
 const get = (row: InputRow, field: string) => cell(own(row, field) ? row[field] : null, schema[field])
 for (const row of authorizedRows) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) reject('calculation_row_required')
  for (const field of Object.keys(schema)) get(row, field)
 }
 for (const group of calculationGroups) {
  if (!Number.isSafeInteger(group.precedence) || group.format !== undefined && (typeof group.format !== 'string' || group.format.length > 512)) reject('invalid_calculation_group')
  validateExpression(group.expression, schema, parameters, true)
 }
 for (const measure of request.measures) {
  if (measure.format !== undefined && (typeof measure.format !== 'string' || measure.format.length > 512)) reject('invalid_measure_format')
  validateExpression(measure.expression, schema, parameters)
 }
 const measures = request.measures.map(measure => applyCalculationGroups(measure, calculationGroups))
 for (const measure of measures) validateExpression(measure.expression, schema, parameters)
 let steps = 0
 const tick = () => { if (++steps > 2000000) reject('calculation_evaluation_limit') }
 function matches(row: InputRow, filter: CalculationFilter): boolean {
  const a = get(row, filter.field)
  if (filter.op === 'is-null') return a.type === 'null'
  const equal = (raw: typeof filter.value) => { const b = cell(raw as never, schema[filter.field]); return a.type === 'null' || b.type === 'null' ? a.type === b.type : compare(a, b) === 0 }
  if (filter.op === 'in') return (filter.value as never[]).some(equal)
  if (filter.op === 'eq' || filter.op === 'ne') return filter.op === 'eq' ? equal(filter.value) : !equal(filter.value)
  if (a.type === 'null') return false
  const b = cell(filter.value as never, schema[filter.field]); if (b.type === 'null') return false
  const c = compare(a, b); return filter.op === 'gte' ? c >= 0 : c <= 0
 }
 const sourceCache = new Map<string, readonly InputRow[]>()
 const contextKey = (activeFilters: CalculationFilter[], dimensions: Record<string, CalculationValue>) => JSON.stringify([activeFilters, Object.keys(dimensions).sort().map(field => [field, valueKey(dimensions[field])])])
 function source(activeFilters: CalculationFilter[], dimensions: Record<string, CalculationValue>): readonly InputRow[] {
  const key = contextKey(activeFilters, dimensions), cached = sourceCache.get(key); if (cached) return cached
  const rows = authorizedRows.filter(row => { tick(); return activeFilters.every(filter => matches(row, filter)) && Object.entries(dimensions).every(([field, value]) => valueKey(get(row, field)) === valueKey(value)) })
  sourceCache.set(key, rows); return rows
 }
 const scopeCache = new Map<string, Scope>()
 function context(activeFilters: CalculationFilter[], dimensions: Record<string, CalculationValue>, total: boolean, fixed = false): Scope {
  const key = JSON.stringify([contextKey(activeFilters, dimensions), total, fixed]), cached = scopeCache.get(key); if (cached) return cached
  const scope: Scope = { rows: source(activeFilters, dimensions), dimensions, filters: activeFilters, total, fixed }; scopeCache.set(key, scope); return scope
 }
 const groupCache = new Map<string, Scope[]>()
 function groups(activeFilters: CalculationFilter[]): Scope[] {
  const cacheKey = JSON.stringify(activeFilters), cached = groupCache.get(cacheKey); if (cached) return cached
  const grouped = new Map<string, Scope>()
  for (const row of source(activeFilters, {})) {
   const dimensions = Object.fromEntries(groupBy.map(field => [field, get(row, field)])), key = JSON.stringify(groupBy.map(field => valueKey(dimensions[field])))
   const existing = grouped.get(key)
   if (existing) (existing.rows as InputRow[]).push(row)
   else grouped.set(key, { rows: [row], dimensions, filters: activeFilters, total: false })
  }
  if (!groupBy.length && !grouped.size) grouped.set('[]', { rows: [], dimensions: {}, filters: activeFilters, total: false })
  const result = [...grouped.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, scope]) => scope)
  groupCache.set(cacheKey, result); return result
 }
 const memo = new WeakMap<Scope, Map<CalculationExpr, CalculationValue>>()
 function evaluate(expression: CalculationExpr, scope: Scope): CalculationValue {
  tick()
  const cached = memo.get(scope)?.get(expression); if (cached) return cached
  const result = compute(expression, scope), values = memo.get(scope) ?? new Map<CalculationExpr, CalculationValue>()
  values.set(expression, result); memo.set(scope, values); return result
 }
 function compute(expression: CalculationExpr, scope: Scope): CalculationValue {
  switch (expression.kind) {
   case 'literal': return expression.type === 'null' ? nil() : cell(expression.value, expression.type)
   case 'parameter': { const parameter = parameters[expression.name]; return parameter.type === 'null' ? nil() : cell(parameter.value, parameter.type) }
   case 'selected-measure': return reject('unresolved_selected_measure')
   case 'field': {
    if (scope.row) return get(scope.row, expression.field)
    if (own(scope.dimensions, expression.field)) return scope.dimensions[expression.field]
    return reject('field_requires_row_or_group_context', expression.field)
   }
   case 'unary': {
    const value = evaluate(expression.expression, scope); if (value.type === 'null') return value
    if (expression.op === 'not') return { type: 'boolean', value: !truth(value) }
    const n = number(value); return numeric(rational(-n.numerator, n.denominator))
   }
   case 'binary': return binary(expression.op, evaluate(expression.left, scope), evaluate(expression.right, scope))
   case 'call': {
    // Branches are lazy: an unchosen branch cannot trigger a context error.
    if (expression.fn === 'if') return evaluate(expression.args[truth(evaluate(expression.args[0], scope)) === true ? 1 : 2], scope)
    if (expression.fn === 'coalesce') { for (const arg of expression.args) { const value = evaluate(arg, scope); if (value.type !== 'null') return value }; return nil() }
    return scalarCall(expression.fn, expression.args.map(arg => evaluate(arg, scope)))
   }
   case 'aggregate': return aggregate(expression.op, expression.expression ? scope.rows.map(row => evaluate(expression.expression!, { ...scope, row })) : scope.rows.map(() => numeric(rational(1n))))
   case 'calculate': {
    // CALCULATE replaces the named user filters and grouped coordinates only;
    // the source remains the already-authorized row set even for ALL().
    const replaced = new Set([...expression.removeFilters, ...expression.filters.map(filter => filter.field)])
    const activeFilters = [...scope.filters.filter(filter => !replaced.has(filter.field)), ...expression.filters]
    const dimensions = Object.fromEntries(Object.entries(scope.dimensions).filter(([field]) => !replaced.has(field)))
    return evaluate(expression.expression, context(activeFilters, dimensions, scope.total, scope.fixed))
   }
   case 'fixed': {
    const dimensions: Record<string, CalculationValue> = Object.create(null)
    const activeFilters = expression.filters === 'ignore-user' ? [] : scope.filters
    if (scope.total && !scope.row) {
     if (expression.totals === 'null') return nil('fixed_total')
     return evaluate(expression.expression, context(activeFilters, {}, true, true))
    }
    for (const field of expression.grain) {
     if (scope.row) dimensions[field] = get(scope.row, field)
     else if (own(scope.dimensions, field)) dimensions[field] = scope.dimensions[field]
     else {
      const values = new Map(scope.rows.map(row => { const value = get(row, field); return [valueKey(value), value] }))
      if (values.size !== 1) reject('fixed_grain_ambiguous', field)
      dimensions[field] = values.values().next().value!
     }
    }
    return evaluate(expression.expression, context(activeFilters, dimensions, scope.total, true))
   }
   case 'percent-of-total': {
    const dimensions = scope.total ? {} : Object.fromEntries(expression.partitionBy.map(field => { if (!own(scope.dimensions, field)) reject('percent_partition_must_be_grouped', field); return [field, scope.dimensions[field]] }))
    const numerator = evaluate(expression.expression, scope), denominator = evaluate(expression.expression, context(scope.filters, dimensions, scope.total, scope.fixed))
    return binary('*', binary('/', numerator, denominator), numeric(rational(100n)))
   }
   case 'window': {
    if (scope.row || scope.fixed) reject('window_requires_visible_group_context')
    return windowValue(expression, scope, groups(scope.filters), evaluate)
   }
  }
 }
 const visible = groups(filters), filtered = source(filters, {}), totalScope: Scope = { rows: filtered, dimensions: {}, filters, total: true }
 const values = (scope: Scope) => Object.fromEntries(measures.map(measure => [measure.id, evaluate(measure.expression, scope)]))
 const toCell = (value: CalculationValue, field: string, scope: Scope): CalculationRequest['authorizedRows'][number][string] => {
  if (value.type === 'null') return null
  // Keep original exact decimal spelling for dimensions; grouping equality was
  // normalized above, so equivalent numeric spellings share a single group.
  if (value.type === 'number') return scope.rows[0]?.[field] ?? null
  return value.value
 }
 return { rows: visible.map(scope => ({ dimensions: groupBy.map(field => toCell(scope.dimensions[field], field, scope)), values: values(scope) })), totals: values(totalScope), formats: Object.fromEntries(measures.map(measure => [measure.id, measure.format ?? null])), inputRows: authorizedRows.length, filteredRows: filtered.length, semantics: CALCULATION_SEMANTICS }
}
