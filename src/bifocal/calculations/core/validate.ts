import { cell } from './values'
import { reject, type CalculationExpr, type CalculationFilter, type DataType, type Literal, type Schema } from './types'

type Inferred = DataType | 'null'
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) reject('calculation_object_required'); return value as Record<string, unknown> }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) reject('unsupported_calculation_property') }
export function fields(value: unknown, schema: Schema): asserts value is string[] {
 if (!Array.isArray(value) || value.length > 32 || new Set(value).size !== value.length) reject('invalid_calculation_fields')
 for (const field of value) if (typeof field !== 'string' || !Object.hasOwn(schema, field)) reject('unknown_calculation_field', String(field))
}
export function validateFilters(value: unknown, schema: Schema): asserts value is CalculationFilter[] {
 if (!Array.isArray(value) || value.length > 64) reject('invalid_calculation_filters')
 for (const raw of value) {
  const f = object(raw); keys(f, ['field', 'op', 'value']); fields([f.field], schema)
  if (!['eq', 'ne', 'in', 'gte', 'lte', 'is-null'].includes(String(f.op))) reject('invalid_calculation_filter')
  if (f.op === 'is-null') { if (f.value !== undefined) reject('unexpected_filter_value'); continue }
  const values = f.op === 'in' ? f.value : [f.value]
  if (!Array.isArray(values) || values.length > 1000 || f.op !== 'in' && Array.isArray(f.value)) reject('invalid_calculation_filter_value')
  if ((f.op === 'gte' || f.op === 'lte') && (f.value === null || schema[String(f.field)] === 'boolean')) reject('ordered_filter_value_required')
  for (const value of values) cell(value as never, schema[String(f.field)])
 }
}
export function validateExpression(value: unknown, schema: Schema, parameters: Record<string, Literal> = {}, selectedMeasure = false): asserts value is CalculationExpr {
 let nodes = 0
 function visit(raw: unknown, depth = 0, insideAggregate = false, insideWindow = false): Inferred {
  if (++nodes > 512 || depth > 24) reject('calculation_expression_limit')
  const e = object(raw), kind = e.kind
  const next = (child: unknown) => visit(child, depth + 1, insideAggregate, insideWindow)
  const expect = (actual: Inferred, expected: DataType) => { if (actual !== 'null' && actual !== expected) reject('calculation_type_mismatch') }
  const compatible = (a: Inferred, b: Inferred) => { if (a !== 'null' && b !== 'null' && a !== b) reject('calculation_type_mismatch'); return a === 'null' ? b : a }
  if (kind === 'literal') {
   keys(e, ['kind', 'type', 'value'])
   if (e.type === 'null') { if (e.value !== null) reject('null_literal_required'); return 'null' }
   if (!['number', 'text', 'date', 'boolean'].includes(String(e.type)) || e.value === undefined || e.value === null) reject('invalid_calculation_literal')
   cell(e.value as never, e.type as DataType); return e.type as DataType
  }
  if (kind === 'field') { keys(e, ['kind', 'field']); fields([e.field], schema); return schema[String(e.field)] }
  if (kind === 'parameter') {
   keys(e, ['kind', 'name']); if (typeof e.name !== 'string' || !Object.hasOwn(parameters, e.name)) reject('unknown_calculation_parameter')
   const parameter = parameters[e.name]; if (!parameter || parameter.kind !== 'literal') reject('literal_parameter_required')
   return visit(parameter, depth + 1, insideAggregate, insideWindow)
  }
  if (kind === 'selected-measure') { keys(e, ['kind']); if (!selectedMeasure) reject('selected_measure_outside_group'); return 'number' }
  if (kind === 'unary') { keys(e, ['kind', 'op', 'expression']); if (e.op !== '-' && e.op !== 'not') reject('invalid_unary_operator'); expect(next(e.expression), e.op === '-' ? 'number' : 'boolean'); return e.op === '-' ? 'number' : 'boolean' }
  if (kind === 'binary') {
   keys(e, ['kind', 'op', 'left', 'right']); const left = next(e.left), right = next(e.right)
   if (['+', '-', '*', '/'].includes(String(e.op))) { expect(left, 'number'); expect(right, 'number'); return 'number' }
   if (['and', 'or'].includes(String(e.op))) { expect(left, 'boolean'); expect(right, 'boolean'); return 'boolean' }
   if (!['=', '<>', '<', '<=', '>', '>='].includes(String(e.op))) reject('invalid_binary_operator')
   compatible(left, right); return 'boolean'
  }
  if (kind === 'call') {
   keys(e, ['kind', 'fn', 'args']); if (!Array.isArray(e.args)) reject('calculation_arguments_required')
   const arity: Record<string, number> = { if: 3, 'is-null': 1, abs: 1, year: 1, month: 1, day: 1, 'date-add-days': 2, 'date-add-months': 2, 'date-add-years': 2, 'date-diff-days': 2 }
   if (e.fn === 'coalesce') { if (!e.args.length || e.args.length > 32) reject('invalid_calculation_arity'); return e.args.map(next).reduce(compatible) }
   if (typeof e.fn !== 'string' || !Object.hasOwn(arity, e.fn) || e.args.length !== arity[e.fn]) reject('invalid_calculation_function_or_arity')
   const args = e.args.map(next)
   if (e.fn === 'if') { expect(args[0], 'boolean'); return compatible(args[1], args[2]) }
   if (e.fn === 'is-null') return 'boolean'
   expect(args[0], e.fn === 'abs' ? 'number' : 'date')
   if (args.length === 2) expect(args[1], e.fn === 'date-diff-days' ? 'date' : 'number')
   return e.fn.startsWith('date-add-') ? 'date' : 'number'
  }
  if (kind === 'aggregate') {
   keys(e, ['kind', 'op', 'expression']); if (insideAggregate) reject('nested_aggregate_requires_fixed_grain')
   if (!['sum', 'count', 'count-distinct', 'avg', 'min', 'max'].includes(String(e.op)) || e.expression === undefined && e.op !== 'count') reject('invalid_calculation_aggregate')
   const type = e.expression === undefined ? 'number' : visit(e.expression, depth + 1, true, insideWindow)
   if (e.op === 'sum' || e.op === 'avg') expect(type, 'number')
   return e.op === 'min' || e.op === 'max' ? type : 'number'
  }
  if (kind === 'calculate') { keys(e, ['kind', 'expression', 'removeFilters', 'filters']); fields(e.removeFilters, schema); validateFilters(e.filters, schema); return next(e.expression) }
  if (kind === 'fixed') {
   keys(e, ['kind', 'grain', 'expression', 'filters', 'totals']); fields(e.grain, schema)
   if (e.filters !== 'retain-user' && e.filters !== 'ignore-user') reject('explicit_fixed_filter_policy_required')
   if (e.totals !== undefined && e.totals !== 'recompute' && e.totals !== 'null') reject('invalid_fixed_totals_policy')
   return visit(e.expression, depth + 1, false, insideWindow)
  }
  if (kind === 'percent-of-total') { keys(e, ['kind', 'expression', 'partitionBy']); fields(e.partitionBy, schema); expect(next(e.expression), 'number'); return 'number' }
  if (kind === 'window') {
   keys(e, ['kind', 'op', 'expression', 'partitionBy', 'orderBy', 'preceding', 'following', 'offset'])
   if (insideAggregate || insideWindow) reject('window_nesting_unsupported')
   if (!['sum', 'avg', 'min', 'max', 'count', 'rank', 'dense-rank', 'row-number', 'lag', 'lead'].includes(String(e.op))) reject('invalid_calculation_window')
   fields(e.partitionBy, schema)
   if (!Array.isArray(e.orderBy) || !e.orderBy.length || e.orderBy.length > 16) reject('explicit_window_order_required')
   for (const order of e.orderBy) {
    const o = object(order); keys(o, ['field', 'expression', 'direction', 'nulls'])
    if ((o.field === undefined) === (o.expression === undefined)) reject('window_order_field_or_expression_required')
    if (o.field !== undefined) fields([o.field], schema); else visit(o.expression, depth + 1, false, true)
    if (!['asc', 'desc'].includes(String(o.direction)) || !['first', 'last'].includes(String(o.nulls))) reject('invalid_window_order')
   }
   for (const property of ['preceding', 'following', 'offset']) if (e[property] !== undefined && !(property === 'preceding' && e[property] === 'unbounded') && (!Number.isInteger(e[property]) || Number(e[property]) < 0 || Number(e[property]) > 10000)) reject('invalid_window_bound')
   if (['sum', 'avg', 'min', 'max', 'count'].includes(String(e.op)) && (e.preceding === undefined || e.following === undefined)) reject('explicit_window_frame_required')
   if ((e.op === 'lag' || e.op === 'lead') && e.offset === undefined) reject('explicit_window_offset_required')
   const type = visit(e.expression, depth + 1, false, true)
   if (e.op === 'sum' || e.op === 'avg') expect(type, 'number')
   return ['count', 'rank', 'dense-rank', 'row-number'].includes(String(e.op)) ? 'number' : type
  }
  return reject('unsupported_calculation_kind', String(kind))
 }
 visit(value)
}
