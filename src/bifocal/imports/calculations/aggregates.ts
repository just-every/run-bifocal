import type { CalculationExpr } from '../../calculations/core'
import { aggregate, arity, binary, bindTable, blank, call, countRows, expressionType, num, requireField } from './helpers'
import { problem, type FormulaLanguage, type Syntax, type TranslationOptions } from './types'

export function aggregateFunction(language: FormulaLanguage, name: string, args: Syntax[], options: TranslationOptions, compile: (node: Syntax) => CalculationExpr): CalculationExpr | undefined {
 if (language === 'dax' && name === 'COUNTROWS') { arity(name, args, 1); bindTable(args[0], options); const count = countRows(); return call('if', binary('=', count, num('0')), blank(), count) }
 if (language === 'dax' && (name === 'SUMX' || name === 'AVERAGEX')) {
  arity(name, args, 2); bindTable(args[0], options); const expression = compile(args[1])
  const hasMeasure = (e: CalculationExpr): boolean => e.kind === 'aggregate' || e.kind === 'calculate' || e.kind === 'fixed' || e.kind === 'window' || e.kind === 'selected-measure' || e.kind === 'percent-of-total' || (e.kind === 'binary' ? hasMeasure(e.left) || hasMeasure(e.right) : e.kind === 'call' ? e.args.some(hasMeasure) : e.kind === 'unary' ? hasMeasure(e.expression) : false)
  if (hasMeasure(expression)) problem('iterator_context_transition', 'Measure references inside iterators require DAX row-to-filter context transition, not nested native aggregates.')
  const result = aggregate(name === 'SUMX' ? 'sum' : 'avg', expression)
  return name === 'SUMX' ? result : call('if', binary('=', countRows(), num('0')), blank(), call('coalesce', result, num('0')))
 }
 const names = language === 'dax' ? ['SUM', 'COUNT', 'COUNTA', 'DISTINCTCOUNT', 'AVERAGE', 'MIN', 'MAX'] : language === 'tableau' ? ['SUM', 'COUNT', 'COUNTD', 'AVG', 'MIN', 'MAX'] : ['SUM', 'COUNT', 'COUNTA', 'AVERAGE', 'MIN', 'MAX']
 if (!names.includes(name)) return undefined
 arity(name, args, 1)
 if (language === 'dax') requireField(args[0], options)
 const expression = compile(args[0]), type = expressionType(expression, options)
 const op = name === 'AVERAGE' || name === 'AVG' ? 'avg' : name === 'COUNTD' || name === 'DISTINCTCOUNT' ? 'count-distinct' : name === 'COUNTA' ? 'count' : name.toLowerCase() as 'sum' | 'count' | 'min' | 'max'
 if ((op === 'sum' || op === 'avg') && type && type !== 'number' && type !== 'null') problem('aggregate_source_type_gap', 'Translate source-specific handling of nonnumeric aggregate inputs before migration.')
 if ((op === 'min' || op === 'max') && type === 'text') problem('source_text_collation', 'Text MIN and MAX requires source-compatible collation before migration.')
 if (name === 'COUNT' && language !== 'tableau') {
  if (!type) problem('count_type_binding', 'Declare the mapped field type to preserve source COUNT rules for text and boolean values.')
  if (language === 'dax' && type === 'boolean') problem('dax_count_boolean', 'DAX COUNT rejects boolean columns; use a source COUNTA measure or change its source model.')
  if (language === 'excel' && type !== 'number' && type !== 'date') {
   if (expression.kind !== 'field') problem('excel_count_literal_coercion', 'COUNT literal coercion needs explicit translation for this argument type.')
   return num('0')
  }
 }
 const result = aggregate(op, expression)
 if (language === 'dax' && (name === 'COUNT' || name === 'COUNTA')) return call('if', binary('=', result, num('0')), blank(), result)
 if (language === 'dax' && name === 'DISTINCTCOUNT') {
  const nullCount = aggregate('count', call('if', call('is-null', expression), num('1'), blank()))
  const withBlank = binary('+', result, call('if', binary('>', nullCount, num('0')), num('1'), num('0')))
  return call('if', binary('=', countRows(), num('0')), blank(), withBlank)
 }
 if (language === 'dax' && name === 'AVERAGE') return call('if', binary('=', countRows(), num('0')), blank(), call('coalesce', result, num('0')))
 if (language === 'excel') {
  if (name === 'AVERAGE') problem('excel_empty_average_error', 'Excel AVERAGE on an empty numeric set raises an error; native null cannot preserve it. Implement an explicit source IFERROR adaptation.')
  if (['SUM', 'MIN', 'MAX'].includes(name)) return call('coalesce', result, num('0'))
  if (name === 'COUNTA') problem('excel_counta_empty_string', 'Excel COUNTA counts empty strings but empty-cell mapping requires workbook cell provenance; preserve that distinction before translation.')
 }
 return result
}
