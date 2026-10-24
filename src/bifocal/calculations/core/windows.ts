import { rational } from '../../currency/decimal'
import { aggregate } from './aggregate'
import { reject, type CalculationExpr, type CalculationValue } from './types'
import { compare, nil, numeric, valueKey } from './values'

export type WindowScope = { dimensions: Record<string, CalculationValue>; total: boolean }
export function windowValue<S extends WindowScope>(expression: Extract<CalculationExpr, { kind: 'window' }>, current: S, peers: S[], evaluate: (expression: CalculationExpr, scope: S) => CalculationValue): CalculationValue {
 if (current.total) return nil('window_total')
 const dimension = (scope: S, field: string) => { if (!Object.hasOwn(scope.dimensions, field)) reject('window_field_must_be_grouped', field); return scope.dimensions[field] }
 const partition = peers.filter(peer => expression.partitionBy.every(field => valueKey(dimension(peer, field)) === valueKey(dimension(current, field))))
 function order(left: S, right: S): number {
  for (const item of expression.orderBy) {
   const a = 'field' in item ? dimension(left, item.field) : evaluate(item.expression, left), b = 'field' in item ? dimension(right, item.field) : evaluate(item.expression, right)
   if (a.type === 'null' || b.type === 'null') { if (a.type === b.type) continue; return (a.type === 'null' ? -1 : 1) * (item.nulls === 'first' ? 1 : -1) }
   const c = compare(a, b); if (c) return c * (item.direction === 'asc' ? 1 : -1)
  }
  return 0
 }
 const scopeKey = (scope: S) => JSON.stringify(Object.keys(scope.dimensions).sort().map(field => [field, valueKey(scope.dimensions[field])]))
 partition.sort((a, b) => order(a, b) || (scopeKey(a) < scopeKey(b) ? -1 : scopeKey(a) > scopeKey(b) ? 1 : 0))
 const index = partition.findIndex(peer => scopeKey(peer) === scopeKey(current)); if (index < 0) reject('window_current_group_unavailable')
 if (expression.op === 'row-number') return numeric(rational(BigInt(index + 1)))
 if (expression.op === 'rank' || expression.op === 'dense-rank') {
  let first = index; while (first > 0 && order(partition[first - 1], partition[index]) === 0) first--
  let rank = first + 1
  if (expression.op === 'dense-rank') { rank = 1; for (let i = 1; i <= first; i++) if (order(partition[i - 1], partition[i]) !== 0) rank++ }
  return numeric(rational(BigInt(rank)))
 }
 if (expression.op === 'lag' || expression.op === 'lead') {
  const target = index + (expression.op === 'lag' ? -1 : 1) * expression.offset!
  return target < 0 || target >= partition.length ? nil('missing_offset') : evaluate(expression.expression, partition[target])
 }
 const start = expression.preceding === 'unbounded' ? 0 : Math.max(0, index - expression.preceding!), end = Math.min(partition.length, index + expression.following! + 1)
 return aggregate(expression.op, partition.slice(start, end).map(peer => evaluate(expression.expression, peer)))
}
