import { reject, type CalculationExpr, type CalculationGroup, type CalculationMeasure } from './types'

function substitute(expression: CalculationExpr, selected: CalculationExpr): CalculationExpr {
 if (expression.kind === 'selected-measure') return selected
 if (expression.kind === 'binary') return { ...expression, left: substitute(expression.left, selected), right: substitute(expression.right, selected) }
 if (expression.kind === 'call') return { ...expression, args: expression.args.map(arg => substitute(arg, selected)) }
 if (expression.kind === 'window') return { ...expression, expression: substitute(expression.expression, selected), orderBy: expression.orderBy.map(order => 'expression' in order ? { ...order, expression: substitute(order.expression, selected) } : order) }
 if ('expression' in expression && expression.expression) return { ...expression, expression: substitute(expression.expression, selected) }
 return expression
}
/** Groups wrap selected measure expressions in ascending precedence order.
 * Thus the highest precedence group is the outer expression. Formats are inert
 * metadata: the highest precedence explicit format replaces the measure format. */
export function applyCalculationGroups(measure: CalculationMeasure, groups: CalculationGroup[]): CalculationMeasure {
 if (new Set(groups.map(group => group.precedence)).size !== groups.length) reject('ambiguous_calculation_group_precedence')
 let result = measure
 for (const group of [...groups].sort((a, b) => a.precedence - b.precedence)) result = { ...result, expression: substitute(group.expression, result.expression), ...(group.format === undefined ? {} : { format: group.format }) }
 return result
}
