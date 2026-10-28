import { evaluateCalculatedField, evaluateCalculations, type CalculationExpr, type CalculationValue, type InputRow, type Literal } from '../../calculations/core'
import { fail } from '../../query/types'
import type { RdlTable } from './execution'

const literal = (value: CalculationValue): Literal => value.type === 'null' ? {kind: 'literal', type: 'null', value: null} : {kind: 'literal', type: value.type, value: value.type === 'number' ? value : value.value}

/** VB IIF evaluates both branches. Evaluate children eagerly before using the
 * native typed operators; never turn source divide errors into blank results.
 * Nullable scalar coercions outside this exact subset explicitly refuse. */
export function evaluateRdlExpression(expression: CalculationExpr, table: RdlTable|undefined, row: InputRow|undefined, parameters: Record<string, Literal>) {
 let steps = 0
 function visit(expression: CalculationExpr, row?: InputRow): CalculationValue {
  if (++steps > 200000) fail('rdl_expression_evaluation_limit', 413)
  const schema = table?.schema ?? {}, scalar = (value: CalculationExpr) => evaluateCalculatedField(value, row ?? {}, schema, parameters)
  if (expression.kind === 'aggregate') {
   if (!table) fail('rdl_aggregate_dataset_required')
   if (expression.expression) for (const source of table.rows) visit(expression.expression, source)
   return evaluateCalculations({authorizedRows: table.rows, schema, parameters, filters: [], groupBy: [], measures: [{id: 'value', expression}]}).totals.value
  }
  if (expression.kind === 'binary') {
   const left = visit(expression.left, row), right = visit(expression.right, row)
   if (left.type === 'null' || right.type === 'null') fail('rdl_nullable_scalar_coercion_unsupported')
   if (expression.op === '/' && right.type === 'number' && BigInt(right.numerator) === 0n) fail('rdl_division_by_zero')
   return scalar({...expression, left: literal(left), right: literal(right)})
  }
  if (expression.kind === 'unary') {
   const value = visit(expression.expression, row)
   if (value.type === 'null') fail('rdl_nullable_scalar_coercion_unsupported')
   return scalar({...expression, expression: literal(value)})
  }
  if (expression.kind === 'call') return scalar({...expression, args: expression.args.map(argument => literal(visit(argument, row)))})
  return scalar(expression)
 }
 return visit(expression, row)
}
