import type { CalculationExpr } from '../../calculations/core'
import { problem } from './types'
/** Count repeated subtrees too: DAX blank adaptations deliberately duplicate
 * expressions, so checking serialized length only would permit exponential
 * expansion before the size check itself could finish. */
export function boundExpression(expression: CalculationExpr): void {
 let nodes = 0
 function visit(raw: unknown, depth: number): void {
  if (++nodes > 512 || depth > 24) problem('translation_expansion_limit', 'The expanded target exceeds 512 nodes or 24 expression levels.')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) problem('mapped_measure_ast', 'Mapped measures must contain serializable calculation AST objects.')
  const e = raw as Record<string, unknown>, next = (value: unknown) => visit(value, depth + 1)
  if (['literal', 'field', 'parameter', 'selected-measure'].includes(String(e.kind))) return
  if (e.kind === 'binary') { next(e.left); next(e.right); return }
  if (e.kind === 'call') { if (!Array.isArray(e.args)) problem('mapped_measure_ast', 'Mapped calculation calls need argument arrays.'); e.args.forEach(next); return }
  if (['unary', 'aggregate', 'calculate', 'fixed', 'window', 'percent-of-total'].includes(String(e.kind))) {
   if (e.expression !== undefined) next(e.expression)
   if (e.kind === 'window') { if (!Array.isArray(e.orderBy)) problem('mapped_measure_ast', 'Mapped windows need explicit order arrays.'); for (const order of e.orderBy) if (order && typeof order === 'object' && Object.hasOwn(order, 'expression')) next(order.expression) }
   return
  }
  problem('mapped_measure_ast', 'The mapped measure contains an unsupported calculation AST node.')
 }
 visit(expression, 0)
}
