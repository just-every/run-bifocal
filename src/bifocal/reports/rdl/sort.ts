import type { CalculationValue, InputRow } from '../../calculations/core'
import { compare } from '../../calculations/core/values'
import { fail } from '../../query/types'
import type { createReportRuntime, RdlTable } from './execution'
import type { RdlNode } from './parse'
import { child, children, text } from './tree'
type Scope = ReturnType<ReturnType<typeof createReportRuntime>['resolve']>

/** Numeric and civil-date sorts are exact. Text collation and nullable sort
 * behavior need source qualification rather than an assumed ordering. */
export function sortRdlGroups(scope: Scope, groups: InputRow[][], table: RdlTable, sort: RdlNode|undefined) {
 if (!sort) return groups
 const expressions = children(sort, 'SortExpression')
 if (!expressions.length || expressions.length > 16) fail('rdl_sort_expression_required')
 const keys = groups.map((rows, index) => ({rows, index, keys: expressions.map(expression => {
  const value = child(expression, 'Value'), direction = text(expression, 'Direction') || 'Ascending'
  if (!value || !['Ascending', 'Descending'].includes(direction)) fail('rdl_sort_direction_unsupported')
  const key = scope.evaluate(value, {...table, rows}, rows.length === 1 ? rows[0] : undefined)
  if (!['number', 'date', 'boolean'].includes(key.type)) fail('rdl_sort_type_requires_source_qualification')
  return {value: key, descending: direction === 'Descending'}
 })}))
 return keys.sort((a, b) => {
  for (let i = 0; i < expressions.length; i++) {
   const result = compare(a.keys[i].value as CalculationValue, b.keys[i].value as CalculationValue)
   if (result) return a.keys[i].descending ? -result : result
  }
  return a.index - b.index
 }).map(group => group.rows)
}
export function sortRdlRows(scope: Scope, table: RdlTable, sort: RdlNode|undefined): RdlTable {
 return sort ? {...table, rows: sortRdlGroups(scope, table.rows.map(row => [row]), table, sort).flat()} : table
}
