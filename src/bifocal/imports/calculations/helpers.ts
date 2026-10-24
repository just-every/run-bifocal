import type { CalculationExpr, DataType, Literal } from '../../calculations/core'
import { problem, type Syntax, type TranslationOptions } from './types'
export const num = (value: string): Literal => ({ kind: 'literal', type: 'number', value })
export const blank = (): Literal => ({ kind: 'literal', type: 'null', value: null })
export const bool = (value: boolean): Literal => ({ kind: 'literal', type: 'boolean', value })
export const call = (fn: 'if' | 'coalesce' | 'is-null', ...args: CalculationExpr[]): CalculationExpr => ({ kind: 'call', fn, args })
export const binary = (op: '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'and' | 'or', left: CalculationExpr, right: CalculationExpr): CalculationExpr => ({ kind: 'binary', op, left, right })
export const countRows = (): CalculationExpr => ({ kind: 'aggregate', op: 'count' })
export const aggregate = (op: 'sum' | 'count' | 'count-distinct' | 'avg' | 'min' | 'max', expression: CalculationExpr): CalculationExpr => ({ kind: 'aggregate', op, expression })
export function arity(name: string, args: unknown[], minimum: number, maximum = minimum) { if (args.length < minimum || args.length > maximum) problem('function_arity', `${name} requires ${minimum === maximum ? minimum : `${minimum}–${maximum}`} arguments.`) }
export function integer(node: Syntax): number {
 const sign = node.kind === 'unary' && node.op === '-' ? -1 : 1, value = node.kind === 'unary' ? node.expression : node
 if (value.kind !== 'literal' || value.type !== 'number' || typeof value.value !== 'string' || !/^\d+$/.test(value.value) || BigInt(value.value) > 10000n) problem('constant_integer_required', 'This function needs an explicit integer between -10,000 and 10,000.')
 return sign * Number(value.value)
}
export function text(node: Syntax): string { if (node.kind !== 'literal' || node.type !== 'text' || typeof node.value !== 'string') problem('constant_text_required', 'This argument must be a constant string.'); return node.value }
export function expressionType(expression: CalculationExpr, options: TranslationOptions): DataType | 'null' | undefined {
 if (expression.kind === 'literal') return expression.type
 if (expression.kind === 'field') return options.fieldTypes?.[expression.field]
 if (expression.kind === 'selected-measure') return 'number'
 if (expression.kind === 'aggregate') return expression.op === 'min' || expression.op === 'max' ? expression.expression && expressionType(expression.expression, options) : 'number'
 if (expression.kind === 'unary') return expression.op === 'not' ? 'boolean' : expressionType(expression.expression, options)
 if (expression.kind === 'calculate' || expression.kind === 'fixed') return expressionType(expression.expression, options)
 if (expression.kind === 'window') return ['rank', 'dense-rank', 'count', 'row-number'].includes(expression.op) ? 'number' : expressionType(expression.expression, options)
 if (expression.kind === 'binary') return ['+', '-', '*', '/'].includes(expression.op) ? 'number' : 'boolean'
 if (expression.kind === 'percent-of-total') return 'number'
 if (expression.kind === 'call') {
  if (expression.fn === 'is-null') return 'boolean'
  if (expression.fn === 'if') return expressionType(expression.args[1], options) ?? expressionType(expression.args[2], options)
  if (expression.fn === 'coalesce') return expression.args.map(arg => expressionType(arg, options)).find(type => type && type !== 'null')
  return expression.fn.startsWith('date-add-') ? 'date' : 'number'
 }
 return undefined
}
export function resolve(node: Syntax, options: TranslationOptions): CalculationExpr {
 if (node.kind !== 'reference' && node.kind !== 'name') problem('field_reference_required', 'This argument must reference a mapped field or measure.')
 const keys = node.kind === 'reference' ? node.table ? [node.source, `${node.table}[${node.name.replace(/]/g, ']]')}]`, `${node.table}.${node.name}`] : [node.source, node.name] : [node.name]
 const targets = [...new Set(keys.filter(key => Object.hasOwn(options.fields, key)).map(key => options.fields[key]))]
 const measures = [...new Set(keys.filter(key => Object.hasOwn(options.measures ?? {}, key)).map(key => options.measures![key]))]
 if (targets.length + measures.length !== 1) problem(targets.length + measures.length ? 'ambiguous_reference' : 'unmapped_reference', `Map ${node.kind === 'reference' ? node.source : node.name} to exactly one field or measure.`)
 if (targets.length) { if (typeof targets[0] !== 'string' || !targets[0]) problem('invalid_field_mapping', 'Mapped fields need nonempty native names.'); return { kind: 'field', field: targets[0] } }
 return measures[0]
}
export function requireField(node: Syntax, options: TranslationOptions): string { const value = resolve(node, options); if (value.kind !== 'field') problem('physical_field_required', 'This source construct requires a mapped field, not a measure.'); return value.field }
export function bindTable(node: Syntax, options: TranslationOptions) { if (node.kind !== 'name' || !options.table || node.name !== options.table) problem('iterator_table_binding', 'Bind this exact source table to the evaluator’s current authorized row scope; table expressions and cross-table iteration require implementation.') }
