import type { CalculationExpr } from '../../calculations/core'
import { arity, integer } from './helpers'
import { problem, type Syntax, type TranslationOptions } from './types'

export function tableCalculation(name: string, args: Syntax[], options: TranslationOptions, compile: (node: Syntax) => CalculationExpr): CalculationExpr | undefined {
 if (!/^(RUNNING_(SUM|AVG|COUNT|MIN|MAX)|WINDOW_(SUM|AVG|COUNT|MIN|MAX)|LOOKUP|RANK|RANK_DENSE)$/.test(name)) return undefined
 if (!options.window || !options.window.orderBy.length) problem('window_binding', 'Supply explicit partitionBy and orderBy choices from the source worksheet; Compute Using is not inferred.')
 const window = { partitionBy: options.window.partitionBy, orderBy: options.window.orderBy }
 if (name === 'LOOKUP') {
  arity(name, args, 2); const offset = integer(args[1])
  return { kind: 'window', op: offset < 0 ? 'lag' : 'lead', expression: compile(args[0]), ...window, offset: Math.abs(offset) }
 }
 if (name === 'RANK' || name === 'RANK_DENSE') {
  arity(name, args, 1, 2)
  // Native core ranks null peers, whereas Tableau excludes them entirely.
  // A source null-filter proof is required rather than silently shifting ranks.
  problem('tableau_rank_null_semantics', 'Tableau excludes NULL values from ranks; native windows rank NULL peers. Implement null-excluded peer scope before migrating this rank.')
 }
 const op = name.slice(name.indexOf('_') + 1).toLowerCase() as 'sum' | 'avg' | 'count' | 'min' | 'max'
 if (name.startsWith('RUNNING_')) { arity(name, args, 1); return { kind: 'window', op, expression: compile(args[0]), ...window, preceding: 'unbounded', following: 0 } }
 arity(name, args, 1, 3)
 if (args.length !== 1 && args.length !== 3) problem('window_frame_arity', 'WINDOW functions take either one expression or an expression with both start and end offsets.')
 // Without bounds Tableau uses the entire partition, expressible with the
 // core's maximum bounded rows because imported datasets cap at 2,000 rows.
 if (args.length === 1) return { kind: 'window', op, expression: compile(args[0]), ...window, preceding: 'unbounded', following: 10000 }
 const start = integer(args[1]), end = integer(args[2])
 if (start > 0 || end < 0) problem('offset_window_frame_gap', 'Native frames must include the current row; source frames entirely before or after it require implementation.')
 return { kind: 'window', op, expression: compile(args[0]), ...window, preceding: Math.abs(start), following: end }
}
