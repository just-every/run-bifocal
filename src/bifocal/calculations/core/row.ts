import { rational } from '../../currency/decimal'
import { binary, scalarCall } from './scalar'
import { reject, type CalculationExpr, type CalculationValue, type InputRow, type Literal, type Schema } from './types'
import { validateExpression } from './validate'
import { cell, nil, number, numeric, truth } from './values'

/** Evaluate a calculated field on one already-authorized row. Context-changing
 * and aggregate nodes are measure-only and are refused here. The caller must
 * declare and store the resulting field type before using it in a later query. */
export function evaluateCalculatedField(expression: CalculationExpr, row: InputRow, schema: Schema, parameters: Record<string, Literal> = {}): CalculationValue {
 validateExpression(expression, schema, parameters)
 function visit(e: CalculationExpr): CalculationValue {
  switch (e.kind) {
   case 'literal': return e.type === 'null' ? nil() : cell(e.value, e.type)
   case 'field': return cell(Object.hasOwn(row, e.field) ? row[e.field] : null, schema[e.field])
   case 'parameter': { const p = parameters[e.name]; return p.type === 'null' ? nil() : cell(p.value, p.type) }
   case 'unary': {
    const value = visit(e.expression); if (value.type === 'null') return value
    if (e.op === 'not') return { type: 'boolean', value: !truth(value) }
    const n = number(value); return numeric(rational(-n.numerator, n.denominator))
   }
   case 'binary': return binary(e.op, visit(e.left), visit(e.right))
   case 'call': {
    if (e.fn === 'if') return visit(e.args[truth(visit(e.args[0])) === true ? 1 : 2])
    if (e.fn === 'coalesce') { for (const argument of e.args) { const value = visit(argument); if (value.type !== 'null') return value }; return nil() }
    return scalarCall(e.fn, e.args.map(visit))
   }
   default: return reject('measure_context_required', e.kind)
  }
 }
 return visit(expression)
}
