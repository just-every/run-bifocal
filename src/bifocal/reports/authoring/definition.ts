import type { Snapshot } from '../../data/snapshots/store.ts'
import { fail } from '../../query/types.ts'
import type { NativeReportDefinition } from './types.ts'

export type { NativeReportDefinition } from './types.ts'
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key)) && allowed.every(key => Object.hasOwn(value, key))

/** Parameters bind equality predicates to the reviewed answer dimensions. */
export function validateDefinition(input: unknown, snapshot: Snapshot): NativeReportDefinition {
 if (!object(input) || !keys(input, ['version', 'title', 'header', 'footer', 'queryId', 'groupBy', 'pageBreakGroups', 'parameters']) || input.version !== 1) fail('native_report_definition_invalid', 400)
 const text = (name: 'title' | 'header' | 'footer', maximum: number, required = false): string => {
  const value = input[name]
  if (typeof value !== 'string' || value.length > maximum || required && !value.trim() || /[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(value)) fail('native_report_text_invalid', 400)
  return value
 }
 const title = text('title', 160, true), header = text('header', 1000), footer = text('footer', 1000)
 if (input.queryId !== snapshot.queryId) fail('native_report_query_mismatch', 409)
 if (input.groupBy !== null && (typeof input.groupBy !== 'string' || !snapshot.definition.groupBy.includes(input.groupBy))) fail('native_report_group_dimension_required', 400)
 if (typeof input.pageBreakGroups !== 'boolean' || input.groupBy === null && input.pageBreakGroups) fail('native_report_group_break_invalid', 400)
 if (!Array.isArray(input.parameters) || input.parameters.length > snapshot.definition.groupBy.length) fail('native_report_parameters_invalid', 400)
 const seen = new Set<string>()
 const parameters = input.parameters.map(parameter => {
  if (!object(parameter) || !keys(parameter, ['column', 'value']) || typeof parameter.column !== 'string' || !snapshot.definition.groupBy.includes(parameter.column) || seen.has(parameter.column)) fail('native_report_parameter_dimension_required', 400)
  const value = parameter.value
  if (value !== null && typeof value !== 'boolean' && typeof value !== 'string' || typeof value === 'string' && value.length > 4096) fail('native_report_parameter_value_invalid', 400)
  seen.add(parameter.column)
  return {column: parameter.column, value}
 })
 parameters.sort((a, b) => a.column < b.column ? -1 : a.column > b.column ? 1 : 0)
 return {version: 1, title, header, footer, queryId: snapshot.queryId, groupBy: input.groupBy, pageBreakGroups: input.pageBreakGroups, parameters}
}
