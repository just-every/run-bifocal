import type { BinaryOp, CalculationExpr } from '../../calculations/core'
import { binary, blank, bool, call, expressionType, num } from './helpers'
import { problem, type FormulaLanguage, type TranslationOptions } from './types'

/** BLANK coercion is explicit in the target tree. Native null propagation is
 * never presented as DAX's loose comparison behavior. */
export function operator(language: FormulaLanguage, op: string, left: CalculationExpr, right: CalculationExpr, options: TranslationOptions): CalculationExpr {
 if (language !== 'tableau' && ['AND', 'OR', '!='].includes(op) || language === 'excel' && ['==', '&&', '||'].includes(op)) problem('source_operator_language', `The ${op} operator is not supported by the declared source language.`)
 const target = ({ AND: 'and', '&&': 'and', OR: 'or', '||': 'or', '!=': '<>', '==': '=' } as Record<string, BinaryOp>)[op] ?? op as BinaryOp
 if (['+', '-', '*', '/'].includes(target) && (expressionType(left, options) === 'date' || expressionType(right, options) === 'date')) problem('date_serial_arithmetic_gap', 'Date serial arithmetic needs a declared result type and source date origin; use an explicitly translated civil date function.')
 if (target === '/' && language !== 'tableau') problem('division_error_semantics', 'Use DAX DIVIDE or Excel IFERROR around division; native null on zero cannot preserve source infinity or error results.')
 if (language === 'tableau') return binary(target, left, right)
 if (target === 'and' || target === 'or') return binary(target, call('coalesce', left, bool(false)), call('coalesce', right, bool(false)))
 if (['+', '-', '*'].includes(target)) {
  if (language === 'dax' && target === '*') return binary(target, left, right)
  const result = binary(target, call('coalesce', left, num('0')), call('coalesce', right, num('0')))
  return language === 'dax' ? call('if', binary('and', call('is-null', left), call('is-null', right)), blank(), result) : result
 }
 const leftType = expressionType(left, options), rightType = expressionType(right, options), type = leftType && leftType !== 'null' ? leftType : rightType
 if (!type) problem('comparison_type_binding', 'Declare fieldTypes for this comparison so source blank coercion can be preserved.')
 if (type === 'text') problem('source_text_collation', 'Source string comparison uses collation behavior not implemented by the binary native comparator; preserve source collation before migration.')
 if (op === '==') return call('if', call('is-null', left), call('is-null', right), call('if', call('is-null', right), bool(false), binary('=', left, right)))
 if (type === 'date') problem('date_blank_comparison_gap', 'Source empty-date coercion uses an 1899 serial-date origin outside the native civil-date range.')
 const zero: CalculationExpr = type === 'boolean' ? bool(false) : num('0')
 return binary(target, call('coalesce', left, zero), call('coalesce', right, zero))
}
